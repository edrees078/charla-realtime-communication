// models/Message.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  toGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  },
  content: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure that either toUser or toGroup is present, but not both:
MessageSchema.pre('save', function (next) {
  if (!this.toUser && !this.toGroup) {
    return next(new Error('Message must have either a toUser or toGroup field.'));
  }
  if (this.toUser && this.toGroup) {
    return next(new Error('Message cannot have both toUser and toGroup fields.'));
  }
  next();
});

module.exports = mongoose.model('Message', MessageSchema);
