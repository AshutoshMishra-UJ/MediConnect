// models/message.model.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'senderType',
    required: true
  },
  senderType: {
    type: String,
    enum: ['Doctor', 'Client'],
    required: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'receiverType',
    required: true
  },
  receiverType: {
    type: String,
    enum: ['Doctor', 'Client'],
    required: true
  },
  message: {
    type: String,
    required: false,
    trim: true,
    default: ""
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'voice'],
    default: 'text'
  },
  fileUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true // Gives us createdAt and updatedAt
});

// Indexes for fast retrieval by chat and time
messageSchema.index({ chatId: 1, createdAt: 1 });
messageSchema.index({ senderId: 1, receiverId: 1 });

export default mongoose.model("Message", messageSchema);
