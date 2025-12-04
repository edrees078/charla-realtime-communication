// models/Calls.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const callSchema = new Schema({
  caller: {
    type: Schema.Types.ObjectId,
    ref: 'User', 
    required: true
  },
  callee: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'answered', 'rejected', 'finished'],
    default: 'initiated'
  },
  startTime: {
    type: Date,
  },
  endTime: {
    type: Date,
  }
}, { timestamps: true });

module.exports = mongoose.model('Calls', callSchema);
