// models/chat.model.js
import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'participants.userType',
      required: true
    },
    userType: {
      type: String,
      enum: ['Doctor', 'Client'],
      required: true
    }
  }],
  lastMessage: {
    type: mongoose.Schema.Types.Mixed
  },
  isActive: {
    type: Boolean,
    default: true
  },
  chatType: {
    type: String,
    enum: ['consultation', 'followup', 'general'],
    default: 'consultation'
  }
}, {
  timestamps: true
});

// Indexes for better performance
chatSchema.index({ 'participants.userId': 1 });
chatSchema.index({ lastMessage: -1 });
chatSchema.index({ createdAt: -1 });

export default mongoose.model("Chat", chatSchema);