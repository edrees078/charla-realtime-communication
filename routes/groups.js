const express = require('express');
const router = express.Router();
const Group = require('../models/Group'); // Adjust path as needed
const auth = require('../middleware/auth'); // For route protection

// @route   POST /api/groups/create
// @desc    Create a new group
// @access  Private
router.post('/create', auth, async (req, res) => {
  const io = req.app.get('io'); // Access the io instance inside the route handler

  const { groupName, memberIDs } = req.body;

  if (!groupName || !Array.isArray(memberIDs) || memberIDs.length === 0) {
    return res.status(400).json({ msg: 'Group name and at least one member ID are required.' });
  }

  try {
    // Ensure the creator is also part of the members array
    // Convert both IDs to strings for a proper comparison if necessary
    const creatorId = req.user.id.toString();
    const stringMemberIDs = memberIDs.map(id => id.toString());

    if (!stringMemberIDs.includes(creatorId)) {
      stringMemberIDs.push(creatorId);
    }

    const group = new Group({
      groupName,
      members: stringMemberIDs.map((id) => ({ userID: id })),
      createdBy: req.user.id,
    });

    await group.save();

    // Emit 'newGroup' event to relevant users
    io.emit('newGroup', {
      groupName: group.groupName,
      groupId: group._id,
      memberIDs: stringMemberIDs,
    });

    res.status(201).json({ msg: 'Group created successfully', group });
  } catch (err) {
    console.error('Error creating group:', err.message);
    res.status(500).send('Server error');
  }
});


// @route   GET /api/groups/my-groups
// @desc    Get groups for the authenticated user
// @access  Private
router.get('/my-groups', auth, async (req, res) => {
  try {
    const groups = await Group.find({ 
      members: { $elemMatch: { userID: req.user.id } } 
    })
    .select('groupName _id')
    .populate('createdBy', 'username email'); // Fetch groupName and _id only

    if (!groups || groups.length === 0) {
      return res.status(404).json({ msg: 'No groups found' });
    }

    res.json(groups);
  } catch (err) {
    console.error('Error fetching user groups:', err.message);
    res.status(500).json({ msg: 'Server error' }); // Return JSON error response
  }
});


// @route   GET /api/groups/:groupId
// @desc    Get group details
// @access  Private
router.get('/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('members.userID', 'username email')
      .populate('createdBy', 'username email');

    if (!group) {
      return res.status(404).json({ msg: 'Group not found' });
    }

    res.json(group);
  } catch (err) {
    console.error('Error fetching group details:', err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
