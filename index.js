require('dotenv').config();
const fs = require('fs');
const https = require('https');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');

// Import your models
const Message = require('./models/Message');
const User = require('./models/User');
const Group = require('./models/Group');
const Calls = require('./models/Calls'); // Must exist at ./models/Calls.js

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/messages', require('./routes/messages'));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/chat/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

// Connect MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.log('Error connecting to MongoDB:', err.message);
    process.exit(1);
  });

// Define the port
const PORT = process.env.PORT || 5000;

// SSL certificate options
const sslOptions = {
  key: fs.readFileSync('./certs/key.pem'),   // Replace with your actual key path
  cert: fs.readFileSync('./certs/cert.pem'), // Replace with your actual cert path
};

// Create HTTPS server
const server = https.createServer(sslOptions, app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

app.use('/api/groups', require('./routes/groups'));

// Track online users: Map of normalizedUserName -> { socketID, userID (DB _id) }
const users = new Map();

/* HELPER FUNCTIONS */
async function getUserIdByUsername(username) {
  // Always normalize
  const normalized = username.trim().toLowerCase();

  // Check in-memory map first
  const userData = users.get(normalized);
  if (userData && mongoose.Types.ObjectId.isValid(userData.userID)) {
    return userData.userID;
  }
  // Otherwise, check DB
  const userRecord = await User.findOne({ username: normalized }, '_id');
  return userRecord ? userRecord._id : null;
}

async function getGroupId(groupId) {
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    const groupRecord = await Group.findOne({ _id: groupId }, '_id');
    return groupRecord ? groupRecord._id : null;
  }
  const groupRecord = await Group.findById(groupId, '_id');
  return groupRecord ? groupRecord._id : null;
}

/* MIDDLEWARE for /api/calls/history route:
   (Very simple token parse, or you can use your existing JWT auth)
*/
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers['x-auth-token'];
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }
    // parse user from token (like you do in your front-end)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf8')
    );
    req.user = payload.user; // { id, username, etc. }
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
};

/* SOCKET.IO LOGIC */
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Register user
  socket.on('register', ({ userID, userName }) => {
    const normalized = userName.trim().toLowerCase();
    users.set(normalized, { socketID: socket.id, userID });
    socket.userName = normalized;
    socket.userID = userID;

    console.log(
      `User registered: ${normalized} (DB _id: ${userID}) with socket ID: ${socket.id}`
    );
  });

  /***************************************************
   *                 CALLING LOGIC
   ***************************************************/

  // Caller initiates call
  socket.on('callUser', async ({ toUser, offer }) => {
    const normalizedToUser = toUser.trim().toLowerCase();
    const toUserData = users.get(normalizedToUser);

    if (!toUserData) {
      console.log(`User ${toUser} not available or offline.`);
      socket.emit('userNotAvailable', { msg: `${toUser} is not online.` });
      return;
    }

    const toUserSocket = toUserData.socketID;
    const toUserDBId = toUserData.userID;

    // Create a call record in DB (status: "initiated"), store startTime
    try {
      const callRecord = new Calls({
        caller: new mongoose.Types.ObjectId(socket.userID),
        callee: new mongoose.Types.ObjectId(toUserDBId),
        status: 'initiated',
        startTime: new Date()
      });
      await callRecord.save();
      console.log('Call record created with ID:', callRecord._id);

      // Inform callee => "callMade"
      io.to(toUserSocket).emit('callMade', {
        offer,
        caller: socket.userName,
        callId: callRecord._id,
      });
      console.log(`callUser -> callMade event forwarded to ${normalizedToUser}`);
    } catch (err) {
      console.error('Error creating call record:', err);
    }
  });

  // Callee answers
  socket.on('makeAnswer', async ({ toUser, answer, callId }) => {
    const normalizedToUser = toUser.trim().toLowerCase();
    console.log(`makeAnswer from ${socket.userName} to ${normalizedToUser}, callId: ${callId}`);

    try {
      await Calls.findByIdAndUpdate(callId, {
        $set: { status: 'answered' },
      });
    } catch (err) {
      console.error('Error updating call record to answered:', err);
    }

    const toUserData = users.get(normalizedToUser);
    if (toUserData) {
      io.to(toUserData.socketID).emit('answerMade', {
        answer,
        callee: socket.userName,
      });
      console.log(`Forwarded answerMade to ${normalizedToUser}`);
    }
  });

  // Callee rejects
  socket.on('rejectCall', async ({ toUser, callId }) => {
    const normalizedToUser = toUser.trim().toLowerCase();

    try {
      // Mark as 'rejected' and set endTime
      await Calls.findByIdAndUpdate(callId, {
        $set: { status: 'rejected', endTime: new Date() },
      });
      console.log(`Call ${callId} rejected by ${socket.userName}`);
    } catch (err) {
      console.error('Error updating call record to rejected:', err);
    }

    const toUserData = users.get(normalizedToUser);
    if (toUserData) {
      io.to(toUserData.socketID).emit('callEnded');
      console.log(`Forwarded callEnded to ${normalizedToUser} (due to rejectCall)`);
    }
  });

  // ICE candidate
  socket.on('iceCandidate', ({ toUser, candidate }) => {
    const normalizedToUser = toUser.trim().toLowerCase();
    const toUserData = users.get(normalizedToUser);
    if (toUserData) {
      console.log(`Forwarding ICE candidate to ${normalizedToUser}`);
      io.to(toUserData.socketID).emit('iceCandidate', { candidate });
    }
  });

  // End call
  socket.on('endCall', async ({ toUser }) => {
    const normalizedToUser = toUser.trim().toLowerCase();
    const toUserData = users.get(normalizedToUser);

    if (toUserData) {
      console.log(`User ${socket.userName} ended call. Notifying ${toUser}`);
      io.to(toUserData.socketID).emit('callEnded');
    }
    // Mark call as finished in DB
    // Here we find the latest "initiated" or "answered" call between these two parties and set endTime
    try {
      const filter = {
        $or: [
          { caller: socket.userID, callee: toUserData.userID },
          { caller: toUserData.userID, callee: socket.userID },
        ],
        status: { $in: ['initiated', 'answered'] }
      };
      const endedCall = await Calls.findOneAndUpdate(
        filter,
        { $set: { status: 'finished', endTime: new Date() } },
        { sort: { startTime: -1 } } // get the latest call
      );
      if (endedCall) {
        console.log(`Call ${endedCall._id} marked as finished.`);
      }
    } catch (err) {
      console.error('Error marking call as finished:', err);
    }
  });

  /***************************************************
   *           OTHER NON-CALL EVENTS
   ***************************************************/
  socket.on('joinRoom', ({ room }) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on('joinGroup', async ({ groupId }) => {
    const validGroupId = await getGroupId(groupId);
    if (!validGroupId) {
      console.log(`Invalid groupId: ${groupId}`);
      return;
    }
    socket.join(validGroupId.toString());
    console.log(`User ${socket.id} joined group: ${validGroupId}`);
    io.to(socket.id).emit('joinGroup', { groupId: validGroupId });
  });

  socket.on('sendGroupMessage', async ({ groupId, message }) => {
    const validGroupId = await getGroupId(groupId);
    if (!validGroupId) {
      console.log(`Invalid groupId: ${groupId}`);
      return;
    }
    io.to(validGroupId.toString()).emit('receiveGroupMessage', {
      groupId: validGroupId.toString(),
      message,
      fromUser: socket.userName,
    });
    console.log(`Group message from ${socket.userName} in group ${validGroupId}: ${message}`);

    try {
      let senderId = socket.userID;
      if (!mongoose.Types.ObjectId.isValid(senderId)) {
        senderId = await getUserIdByUsername(socket.userName);
        if (!senderId) {
          console.log('Sender not found in DB, cannot save group msg.');
          return;
        }
        socket.userID = senderId;
      }
      const newMessage = new Message({
        fromUser: senderId,
        toGroup: validGroupId,
        content: message,
      });
      await newMessage.save();
    } catch (err) {
      console.error('Error saving group message:', err);
    }
  });

  socket.on('startPrivateChat', ({ fromUser, toUser }) => {
    const fromU = fromUser.trim().toLowerCase();
    const toU = toUser.trim().toLowerCase();

    const toUserData = users.get(toU);
    const fromUserData = users.get(fromU);

    if (fromUserData && toUserData) {
      io.to(fromUserData.socketID).emit('privateChatStarted', { withUser: toUser });
      io.to(toUserData.socketID).emit('privateChatStarted', { withUser: fromUser });
      console.log(`Private chat started between ${fromUser} and ${toUser}`);
    } else {
      console.log(`User ${toUser} is not online or not registered.`);
      socket.emit('userNotAvailable', { msg: `${toUser} is not available for chat.` });
    }
  });

  socket.on('sendPrivateMessage', async ({ fromUser, toUser, message }) => {
    const fromU = fromUser.trim().toLowerCase();
    const toU = toUser.trim().toLowerCase();
    const toUserData = users.get(toU);

    if (toUserData) {
      io.to(toUserData.socketID).emit('receivePrivateMessage', { fromUser, message });
      console.log(`Private message from ${fromUser} to ${toUser}: ${message}`);
    } else {
      socket.emit('userNotAvailable', { msg: `${toUser} is not available for chat.` });
    }

    try {
      const senderId = await getUserIdByUsername(fromU);
      const receiverId = await getUserIdByUsername(toU);
      if (!senderId || !receiverId) {
        console.log('Sender or receiver not found in DB, cannot save message.');
        return;
      }
      const newMessage = new Message({
        fromUser: senderId,
        toUser: receiverId,
        content: message,
      });
      await newMessage.save();
      console.log('Private message saved successfully.');
    } catch (err) {
      console.error('Error saving private message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (let [userName, userData] of users.entries()) {
      if (userData.socketID === socket.id) {
        users.delete(userName);
        console.log(`User with name ${userName} has been removed from the map.`);
        break;
      }
    }
  });
});

/* (Optional) Chat History API (not implemented) */
app.get('/api/chats', async (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ msg: 'Both usernames are required' });
  }
  try {
    // Not implemented
    res.status(501).json({ msg: 'Not implemented.' });
  } catch (err) {
    console.error('Error fetching chat history:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ==== Call History: GET /api/calls/history ====
app.get('/api/calls/history', authMiddleware, async (req, res) => {
  try {
    // The user’s DB _id from the token
    const userId = req.user.id;

    // Find calls where the user is either the caller or callee
    const calls = await Calls.find({
      $or: [{ caller: userId }, { callee: userId }],
    })
      .populate('caller', 'username')
      .populate('callee', 'username')
      .sort({ startTime: -1 });

    res.json(calls);
  } catch (err) {
    console.error('Error getting call history:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Start HTTPS server
server.listen(PORT, () => {
  console.log(`Secure server with WebSocket running on port ${PORT}`);
});
