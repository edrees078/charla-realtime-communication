// routes/messages.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');


// @route GET /api/messages/private/:username
// @desc  Get messages between the authenticated user and another user
// @access Private
router.get('/private/:username', auth, async (req, res) => {
  try {
    const otherUser = await User.findOne({ username: req.params.username });
    if (!otherUser) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const messages = await Message.find({
      $or: [
        { fromUser: req.user.id, toUser: otherUser._id },
        { fromUser: otherUser._id, toUser: req.user.id },
      ],
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error('Error fetching private messages:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route GET /api/messages/group/:groupId
// @desc  Get messages for a group
// @access Private
router.get('/group/:groupId', auth, async (req, res) => {
    try {
      const messages = await Message.find({ toGroup: req.params.groupId })
        .sort({ createdAt: 1 });
      res.json(messages);
    } catch (err) {
      console.error('Error fetching group messages:', err);
      res.status(500).json({ msg: 'Server error' });
    }
  });
  

  module.exports = router;
