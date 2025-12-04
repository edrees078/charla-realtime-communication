/***** GLOBAL VARIABLES *****/
// Retrieve the token from sessionStorage
const token = sessionStorage.getItem('token');
let username = '';
let userGroupIds = []; // Keep track of groups the user is a member of
const messageCache = {}; // Cache for private or group messages

// WebRTC variables
let currentGroupId = null;
let peerConnection = null;
let localStream = null;
let remoteUser = null;

// Call panel variables (timer, mute status)
let callTimerInterval = null;
let callStartTime = 0;
let isMuted = false;

/**
 * STUN/TURN servers (Adjust to your own).
 * If your local TURN is not reachable, remove or replace it!
 */
const configuration = {
  iceServers: [
    { urls: 'stun:192.168.1.41:3478' },
    
     {
       urls: 'turn:192.168.1.41:3478?transport=udp',
        username: 'idris78',
        credential: 'Edrees123'
     }
  ]
};

/***** AUTH & USER SETUP *****/
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    username = payload.user.username.toLowerCase();
    document.getElementById('greeting').textContent = `Welcome: ${username}`;
  } catch (err) {
    console.error('Invalid token format:', err);
  }
} else {
  alert('Session expired or not logged in. Please log in again.');
  window.location.href = '/login'; 
}

/***** SOCKET.IO CLIENT *****/
const socket = io('https://localhost:5000', {
  rejectUnauthorized: false,
  secure: true
});

// On successful connection
socket.on('connect', () => {
  console.log('Socket connected with ID:', socket.id);

  // Register user with the DB _id from token
  let dbUserId = '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    dbUserId = payload.user.id;
  } catch {}
  socket.emit('register', { userID: dbUserId, userName: username });

  // Rejoin any known group rooms
  userGroupIds.forEach((groupId) => {
    socket.emit('joinGroup', { groupId });
  });
});

// Catch user not available
socket.on('userNotAvailable', ({ msg }) => {
  alert(msg || 'User is offline.');
});

/***** LOGOUT *****/
function logout() {
  sessionStorage.removeItem('token');
  window.location.href = '/login';
}
document.getElementById('logoutButton').addEventListener('click', logout);

/**************************************************************************/
/***************************** PRIVATE CHAT *******************************/
/**************************************************************************/

function addUserToSidebar(user) {
  const userList = document.getElementById('userList');
  const existingUser = Array.from(userList.children).find(
    (li) => li.dataset.username === user.username
  );
  if (!existingUser) {
    const li = document.createElement('li');
    li.textContent = user.username;
    li.dataset.username = user.username;
    li.dataset.userId = user.userID;
    li.addEventListener('click', () => openPrivateChat(user.username));
    userList.appendChild(li);
  }
}

function openPrivateChat(chatPartner) {
  document.getElementById('currentChatPartner').textContent = chatPartner;
  currentGroupId = null; // Not in a group chat

  // Show the Call button
  document.getElementById('startCallButton').style.display = 'inline-block';

  // Load messages from local cache
  loadMessages(chatPartner);

  // Remove unread highlight, if any
  const userList = document.getElementById('userList');
  const userElement = Array.from(userList.children).find(
    (li) => li.dataset.username === chatPartner
  );
  if (userElement) {
    userElement.classList.remove('unread');
  }
}

/** Search for a user by name */
async function searchUser() {
  const usernameToSearch = document.getElementById('searchUser').value.trim();
  if (!usernameToSearch) {
    alert('Please enter a username to search');
    return;
  }
  try {
    const response = await fetch(`/api/users/search?username=${usernameToSearch}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
    });
    if (response.ok) {
      const data = await response.json();
      alert(`User "${data.username}" found!`);
      addUserToSidebar(data);
    } else {
      const error = await response.json();
      alert(error.msg || 'Error searching for user.');
    }
  } catch (error) {
    console.error('Error searching for user:', error);
    alert('An error occurred while searching for the user.');
  }
}
document.getElementById('searchButton').addEventListener('click', searchUser);

function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const message = messageInput.value.trim();

  const chatPartner = document.getElementById('currentChatPartner').textContent;
  if (!chatPartner) {
    alert('No private chat selected.');
    return;
  }

  if (message) {
    const normalizedPartner = chatPartner.toLowerCase();
    socket.emit('sendPrivateMessage', {
      fromUser: username,
      toUser: normalizedPartner,
      message
    });
    messageInput.value = '';

    // Display in chat + store in local cache
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = createMessageElement('You', message, true);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (!messageCache[chatPartner]) {
      messageCache[chatPartner] = [];
    }
    messageCache[chatPartner].push({ from: 'You', message, isSelf: true });
  }
}

// Listen for private messages from the server
socket.on('receivePrivateMessage', ({ fromUser, message }) => {
  if (!messageCache[fromUser]) {
    messageCache[fromUser] = [];
  }
  messageCache[fromUser].push({ from: fromUser, message, isSelf: false });

  const currentChatPartner = document.getElementById('currentChatPartner').textContent;
  if (currentChatPartner.toLowerCase() === fromUser.toLowerCase()) {
    // If currently chatting with them, display immediately
    const chatMessages = document.getElementById('chatMessages');
    const msgElem = createMessageElement(fromUser, message, false);
    chatMessages.appendChild(msgElem);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else {
    // Mark as unread in the sidebar
    const userList = document.getElementById('userList');
    const userElement = Array.from(userList.children).find(
      (li) => li.dataset.username.toLowerCase() === fromUser.toLowerCase()
    );
    if (userElement) {
      userElement.classList.add('unread');
    }
  }
});

/**************************************************************************/
/****************************** GROUP CHAT ********************************/
/**************************************************************************/

document.getElementById('sendButton').addEventListener('click', () => {
  if (currentGroupId) {
    sendGroupMessage();
  } else {
    sendMessage();
  }
});

document.getElementById('createGroupButton').addEventListener('click', async () => {
  const groupName = document.getElementById('groupNameInput').value.trim();
  const selectedUsers = Array.from(
    document.querySelectorAll('#groupUserSelectionList .selected')
  ).map((li) => li.dataset.userid);

  if (!groupName || selectedUsers.length === 0) {
    alert('Please provide a group name and select at least one user.');
    return;
  }

  try {
    const response = await fetch('/api/groups/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
      body: JSON.stringify({ groupName, memberIDs: selectedUsers }),
    });

    if (response.ok) {
      const { group } = await response.json();
      alert(`Group "${group.groupName}" created successfully!`);

      // Add to the group list
      const groupList = document.getElementById('groupList');
      const groupItem = document.createElement('li');
      groupItem.textContent = group.groupName;
      groupItem.dataset.groupId = group._id;
      groupItem.addEventListener('click', () => openGroupChat(group._id));
      groupList.appendChild(groupItem);

      // Reset
      document.getElementById('groupNameInput').value = '';
      document.getElementById('groupUserSelectionList').innerHTML = '';
      document.getElementById('groupCreationBox').style.display = 'none';
    } else {
      const error = await response.json();
      alert(`Failed to create group: ${error.msg}`);
    }
  } catch (error) {
    console.error('Error creating group:', error);
    alert('An error occurred while creating the group.');
  }
});

function populateGroupUserSelection() {
  const userList = document.getElementById('userList');
  const groupUserSelectionList = document.getElementById('groupUserSelectionList');
  groupUserSelectionList.innerHTML = '';

  Array.from(userList.children).forEach((el) => {
    const li = document.createElement('li');
    li.textContent = el.textContent;
    li.dataset.userid = el.dataset.userid;
    li.addEventListener('click', () => li.classList.toggle('selected'));
    groupUserSelectionList.appendChild(li);
  });
}

document.getElementById('toggleGroupCreation').addEventListener('click', () => {
  const box = document.getElementById('groupCreationBox');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
  populateGroupUserSelection();
});

function sendGroupMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  if (!currentGroupId) {
    alert('No group selected!');
    return;
  }
  if (!message) return;

  socket.emit('sendGroupMessage', { groupId: currentGroupId, message });
  input.value = '';

  // Display in chat + local cache
  const chatMsgs = document.getElementById('chatMessages');
  const msgElem = createMessageElement('You', message, true);
  chatMsgs.appendChild(msgElem);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;

  if (!messageCache[currentGroupId]) {
    messageCache[currentGroupId] = [];
  }
  messageCache[currentGroupId].push({ from: 'You', message, isSelf: true });
}

// Listen for group messages
socket.on('receiveGroupMessage', ({ groupId, message, fromUser }) => {
  if (!messageCache[groupId]) {
    messageCache[groupId] = [];
  }
  // If the message is from us, skip re-display
  if (fromUser.toLowerCase() === username.toLowerCase()) {
    return;
  }

  messageCache[groupId].push({ from: fromUser, message, isSelf: false });

  if (currentGroupId === groupId) {
    // We’re in this group chat now
    const chatMsgs = document.getElementById('chatMessages');
    const msgElem = createMessageElement(fromUser, message, false);
    chatMsgs.appendChild(msgElem);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  } else {
    // Mark as unread
    const groupList = document.getElementById('groupList');
    const groupItem = Array.from(groupList.children).find(
      (li) => li.dataset.groupId === groupId
    );
    if (groupItem) {
      groupItem.classList.add('unread');
    }
  }
});

async function fetchUserGroups() {
  try {
    const response = await fetch('/api/groups/my-groups', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
    });
    if (response.ok) {
      const groups = await response.json();
      userGroupIds = groups.map((grp) => grp._id);
      renderGroups(groups);
    } else {
      console.error('Failed to fetch groups:', await response.text());
    }
  } catch (err) {
    console.error('Error fetching groups:', err);
  }
}
fetchUserGroups();

function renderGroups(groups) {
  const groupList = document.getElementById('groupList');
  groupList.innerHTML = '';
  groups.forEach((g) => {
    const li = document.createElement('li');
    li.textContent = g.groupName;
    li.dataset.groupId = g._id;
    li.addEventListener('click', () => openGroupChat(g._id));
    groupList.appendChild(li);
  });
}

async function openGroupChat(groupId) {
  currentGroupId = groupId;
  document.getElementById('currentChatPartner').textContent = '';
  document.getElementById('startCallButton').style.display = 'none';

  try {
    const resp = await fetch(`/api/groups/${groupId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
    });
    if (resp.ok) {
      const groupData = await resp.json();
      document.getElementById('chatHeader').textContent = `Group Chat: ${groupData.groupName}`;

      document.getElementById('chatMessages').innerHTML = '';

      socket.emit('joinGroup', { groupId });

      if (!messageCache[groupId]) {
        messageCache[groupId] = [];
      }
      loadMessages(groupId);

      // Clear unread
      const groupList = document.getElementById('groupList');
      const groupItem = Array.from(groupList.children).find(
        (li) => li.dataset.groupId === groupId
      );
      if (groupItem) {
        groupItem.classList.remove('unread');
      }
    } else {
      const error = await resp.json();
      alert('Failed to open group chat: ' + error.msg);
    }
  } catch (err) {
    console.error('Error opening group chat:', err);
  }
}

socket.on('newGroup', ({ groupName, groupId, memberIDs }) => {
  // If you want to handle real-time new group creation:
  const payload = JSON.parse(atob(token.split('.')[1]));
  if (memberIDs.includes(payload.user.id)) {
    const groupList = document.getElementById('groupList');
    const li = document.createElement('li');
    li.textContent = groupName;
    li.dataset.groupId = groupId;
    li.addEventListener('click', () => openGroupChat(groupId));
    groupList.appendChild(li);
    socket.emit('joinGroup', { groupId });
  }
});

socket.on('joinGroup', ({ groupId }) => {
  console.log(`Joined group: ${groupId}`);
});

/**************************************************************************/
/******************************* DARK MODE *******************************/
/**************************************************************************/

const toggleDarkModeButton = document.getElementById('toggleDarkMode');
const isDarkMode = localStorage.getItem('darkMode') === 'enabled';

if (isDarkMode) {
  enableDarkMode();
} else {
  disableDarkMode();
}

toggleDarkModeButton.addEventListener('click', () => {
  if (document.body.classList.contains('dark-mode')) {
    disableDarkMode();
  } else {
    enableDarkMode();
  }
});

function enableDarkMode() {
  document.body.classList.add('dark-mode');
  localStorage.setItem('darkMode', 'enabled');
  toggleDarkModeButton.textContent = 'Light Mode';
}

function disableDarkMode() {
  document.body.classList.remove('dark-mode');
  localStorage.setItem('darkMode', 'disabled');
  toggleDarkModeButton.textContent = 'Dark Mode';
}

/**************************************************************************/
/****************************** WEBRTC CALL *******************************/
/**************************************************************************/

document.getElementById('hangUpButton').style.display = 'none';
document.getElementById('startCallButton').addEventListener('click', startCall);

/** 1) Caller => "callUser" => server => "callMade" => callee => sees incoming modal */
async function startCall() {
  const chatPartner = document
    .getElementById('currentChatPartner')
    .textContent.trim();
  if (!chatPartner) {
    alert('No private chat partner selected!');
    return;
  }
  remoteUser = chatPartner.toLowerCase();

  try {
    console.log('Requesting local audio...');
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('Local stream acquired:', localStream.getTracks());

    peerConnection = new RTCPeerConnection(configuration);

    // Add local tracks
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // ICE
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('iceCandidate', { toUser: remoteUser, candidate: event.candidate });
      }
    };

    // Remote track
    peerConnection.ontrack = (event) => {
      console.log('Caller sees remote track =>', event.streams);
      const remoteAudio = document.getElementById('remoteAudio');
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch((err) => console.error('Auto-play blocked:', err));
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('callUser', { toUser: remoteUser, offer });
    console.log(`Emitting "callUser" to ${remoteUser} with our offer...`);

    // Show outgoing call modal
    document.getElementById('outgoingCallModal').style.display = 'block';
    document.getElementById('outgoingCallerName').textContent = `Calling ${chatPartner}...`;
  } catch (err) {
    console.error('Error starting call:', err);
    alert('Could not start the call. Check console.');
  }
}

/** Caller can cancel before the callee answers */
document.getElementById('cancelCallButton').addEventListener('click', () => {
  if (remoteUser) {
    socket.emit('endCall', { toUser: remoteUser });
  }
  endCurrentCall();
  document.getElementById('outgoingCallModal').style.display = 'none';
});

/** 2) Callee sees "callMade" => user can accept or reject */
socket.on('callMade', ({ offer, caller, callId }) => {
  console.log('Received "callMade":', { offer, caller, callId });
  window.lastOfferFromCaller = offer;
  window.remoteUser = caller;
  window.currentCallId = callId;

  document.getElementById('callerName').textContent = `${caller} is calling you...`;
  document.getElementById('incomingCallModal').style.display = 'block';
});

// 3) Callee clicks "Accept" => create answer => "makeAnswer"
document.getElementById('acceptCallButton').addEventListener('click', acceptCall);
document.getElementById('rejectCallButton').addEventListener('click', rejectCall);

async function acceptCall() {
  document.getElementById('incomingCallModal').style.display = 'none';
  try {
    peerConnection = new RTCPeerConnection(configuration);

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    await peerConnection.setRemoteDescription(new RTCSessionDescription(window.lastOfferFromCaller));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // ICE
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('iceCandidate', { toUser: window.remoteUser, candidate: event.candidate });
      }
    };

    // Remote track
    peerConnection.ontrack = (event) => {
      console.log('Callee sees remote track =>', event.streams);
      const remoteAudio = document.getElementById('remoteAudio');
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch((err) => console.error('Autoplay blocked:', err));
    };

    // Send "makeAnswer"
    socket.emit('makeAnswer', {
      toUser: window.remoteUser,
      answer,
      callId: window.currentCallId
    });

    // Hide any outgoing modal
    document.getElementById('outgoingCallModal').style.display = 'none';
    showCallControlPanel();
  } catch (err) {
    console.error('Error accepting call:', err);
  }
}

// 4) Callee rejects
function rejectCall() {
  console.log('Reject call from:', window.remoteUser);
  document.getElementById('incomingCallModal').style.display = 'none';
  socket.emit('rejectCall', {
    toUser: window.remoteUser,
    callId: window.currentCallId
  });
}

// 5) Caller sees "answerMade" => sets remote desc => call connected
socket.on('answerMade', async ({ answer, callee }) => {
  if (!peerConnection) return;
  try {
    console.log(`"answerMade" from ${callee}. Setting remote desc...`);
    document.getElementById('outgoingCallModal').style.display = 'none';
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    // Show call UI
    showCallControlPanel();
  } catch (err) {
    console.error('Error setting remote desc from answer:', err);
  }
});

// ICE candidate
socket.on('iceCandidate', async ({ candidate }) => {
  if (candidate && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

// End call => both sides => "callEnded"
socket.on('callEnded', () => {
  console.log('Server says call ended => local cleanup');
  endCurrentCall();
  // ==== Call History: automatically refresh after call ends ====
  fetchCallHistory();
});

// Manual end call => "endCall"
document.getElementById('muteToggleButton').addEventListener('click', toggleMute);
document.getElementById('endCallButton').addEventListener('click', () => {
  if (remoteUser) {
    socket.emit('endCall', { toUser: remoteUser });
  }
  endCurrentCall();
});

/**************************************************************************/
/************************* CALL CONTROL PANEL *****************************/
/**************************************************************************/

function showCallControlPanel() {
  document.getElementById('callControlPanel').style.display = 'flex';
  callStartTime = Date.now();
  document.getElementById('callTimer').textContent = '00:00';

  callTimerInterval = setInterval(() => {
    updateCallTimer();
  }, 1000);
}

function hideCallControlPanel() {
  document.getElementById('callControlPanel').style.display = 'none';
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  document.getElementById('callTimer').textContent = '00:00';
}

function updateCallTimer() {
  const elapsed = Date.now() - callStartTime;
  const totalSeconds = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  document.getElementById('callTimer').textContent = `${mm}:${ss}`;
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });
  document.getElementById('muteToggleButton').textContent = isMuted ? 'Unmute' : 'Mute';
}

/** Clean up the call entirely from our side */
function endCurrentCall() {
  console.log('endCurrentCall() triggered. Cleaning up local call...');

  // Hide incoming/outgoing modals
  document.getElementById('incomingCallModal').style.display = 'none';
  document.getElementById('outgoingCallModal').style.display = 'none';

  // Hide call panel
  hideCallControlPanel();

  // Reset local mute
  isMuted = false;
  document.getElementById('muteToggleButton').textContent = 'Mute';

  // Close peerConnection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  // Stop local tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  remoteUser = null;
  document.getElementById('remoteAudio').srcObject = null;
  document.getElementById('hangUpButton').style.display = 'none';

  console.log('Call ended locally.');
}

/**************************************************************************/
/***************************** HELPER FUNCTIONS ***************************/
/**************************************************************************/

function createMessageElement(from, message, isSelf) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', isSelf ? 'from-self' : 'from-others');

  const bubble = document.createElement('div');
  bubble.classList.add('message-bubble');

  if (!isSelf) {
    const sender = document.createElement('div');
    sender.classList.add('sender');
    sender.textContent = from;
    bubble.appendChild(sender);
  }

  const textEl = document.createElement('div');
  textEl.classList.add('message-text');
  textEl.textContent = message;
  bubble.appendChild(textEl);

  const timeEl = document.createElement('div');
  timeEl.classList.add('timestamp');
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  timeEl.textContent = timestamp;
  bubble.appendChild(timeEl);

  msgDiv.appendChild(bubble);
  return msgDiv;
}

/** Load messages from local cache for a user or group ID */
function loadMessages(identifier) {
  const chatMsgs = document.getElementById('chatMessages');
  chatMsgs.innerHTML = '';
  if (messageCache[identifier]) {
    messageCache[identifier].forEach(({ from, message, isSelf }) => {
      const elem = createMessageElement(from, message, isSelf);
      chatMsgs.appendChild(elem);
    });
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }
}

/**************************************************************************/
/**************************** CALL HISTORY LOGIC **************************/
/**************************************************************************/
// ==== Call History: START ====

/**
 * Fetch the user's call history from the server and update the UI.
 * This is called after login, page load, or whenever a call ends.
 */
async function fetchCallHistory() {
  try {
    const res = await fetch('/api/calls/history', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      },
    });
    if (!res.ok) {
      console.error('Failed to fetch call history:', await res.text());
      return;
    }
    const callHistory = await res.json();
    renderCallHistory(callHistory);
  } catch (err) {
    console.error('Error fetching call history:', err);
  }
}

/**
 * Renders the call history array into the #callHistoryList <ul>.
 */
function renderCallHistory(callHistoryArray) {
  const listEl = document.getElementById('callHistoryList');
  listEl.innerHTML = '';

  callHistoryArray.forEach((call) => {
    const li = document.createElement('li');
    li.classList.add('call-history-item');

    // Decide incoming/outgoing/missed:
    // You can compare call.caller._id with the current user ID to see if it's outgoing or incoming.
    // If status is "rejected" or you have start/end times, you can show "missed" or "duration" etc.

    const isOutgoing = call.caller.username.toLowerCase() === username.toLowerCase();
    let callDirectionIcon = isOutgoing ? '➡️' : '⬅️';
    if (call.status === 'rejected') {
      callDirectionIcon = '❌';
    }

    // Duration if ended
    let durationText = '';
    if (call.startTime && call.endTime) {
      const duration = Math.floor((new Date(call.endTime) - new Date(call.startTime)) / 1000);
      const mm = String(Math.floor(duration / 60)).padStart(2, '0');
      const ss = String(duration % 60).padStart(2, '0');
      durationText = `(${mm}:${ss})`;
    }

    // Format date
    let callTime = '';
    if (call.startTime) {
      const d = new Date(call.startTime);
      callTime = d.toLocaleString();
    }

    // The name of the other user
    const otherParty = isOutgoing ? call.callee.username : call.caller.username;
    li.textContent = `${callDirectionIcon} ${otherParty} @ ${callTime} ${durationText}`;

    // Optional: add an event to click on the call item for details or replay
    li.addEventListener('click', () => {
      alert(`Clicked on call record:\n${JSON.stringify(call, null, 2)}`);
      // Or open a modal with details, or route to a call replay, etc.
    });

    listEl.appendChild(li);
  });
}

// On page load, fetch the initial call history:
fetchCallHistory();
// ==== Call History: END ====
