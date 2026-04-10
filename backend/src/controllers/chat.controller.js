// controllers/chat.controller.js
import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import Doctor from "../models/doctor.models.js";
import Client from "../models/client.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToCloud } from "../utils/cloudinary.js";

// Create or get existing chat between doctor and client
const createOrGetChat = asyncHandler(async (req, res) => {
  const { participantId, participantType } = req.body;

  if (!participantId || !participantType) {
    throw new ApiError(400, "Participant ID and type are required");
  }

  // Determine current user type
  const currentUser = req.doctor ?
    { userId: req.doctor._id, userType: 'Doctor' } :
    { userId: req.client._id, userType: 'Client' };

  // Validate participant exists
  const Model = participantType === 'Doctor' ? Doctor : Client;
  const participant = await Model.findById(participantId);
  if (!participant) {
    throw new ApiError(404, `${participantType} not found`);
  }

  // Check if chat already exists
  let chat = await Chat.findOne({
    $and: [
      { 'participants.userId': currentUser.userId },
      { 'participants.userId': participantId }
    ]
  }).populate('participants.userId', 'name email avatar');

  // Create new chat if doesn't exist
  if (!chat) {
    chat = await Chat.create({
      participants: [
        currentUser,
        { userId: participantId, userType: participantType }
      ],
      chatType: 'consultation'
    });

    chat = await Chat.findById(chat._id).populate('participants.userId', 'name email avatar');
  }

  return res.status(200).json(new ApiResponse(200, chat, "Chat retrieved successfully"));
});

// Get all chats for current user
const getUserChats = asyncHandler(async (req, res) => {
  const currentUser = req.doctor ? req.doctor._id : req.client._id;

  const chats = await Chat.find({
    'participants.userId': currentUser,
    isActive: true
  })
    .populate('participants.userId', 'name email avatar specialization')
    .sort({ lastMessage: -1 })
    .limit(50);

  return res.status(200).json(new ApiResponse(200, chats, "Chats retrieved successfully"));
});

// Send message
const sendMessage = asyncHandler(async (req, res) => {
  const { chatId, content, messageType = 'text' } = req.body;

  const trimmedContent = (content || '').trim();

  if (!chatId) {
    throw new ApiError(400, "Chat ID is required");
  }

  if (!trimmedContent && !req.file) {
    throw new ApiError(400, "Message content or file is required");
  }

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, "Chat not found");
  }

  // Verify user is participant
  const currentUser = req.doctor ? req.doctor._id : req.client._id;
  const isParticipant = chat.participants.some(p => p.userId.toString() === currentUser.toString());

  if (!isParticipant) {
    throw new ApiError(403, "You are not a participant in this chat");
  }

  let fileUrl = null;
  if (req.file && messageType !== 'text') {
    const uploadResult = await uploadToCloud(req.file.path);
    if (!uploadResult) {
      throw new ApiError(500, "File upload failed");
    }
    fileUrl = uploadResult.url;
  }

  const senderType = req.doctor ? 'Doctor' : 'Client';
  const receiverParticipant = chat.participants.find(p => p.userId.toString() !== currentUser.toString());
  const receiverType = receiverParticipant ? receiverParticipant.userType : (req.doctor ? 'Client' : 'Doctor');
  const receiverId = receiverParticipant ? receiverParticipant.userId : currentUser;

  const newDoc = await Message.create({
    chatId,
    senderId: currentUser,
    senderType,
    receiverId,
    receiverType,
    message: trimmedContent,
    messageType,
    fileUrl
  });

  await newDoc.populate('senderId', 'name avatar');

  const savedMessage = {
    _id: newDoc._id,
    chatId: newDoc.chatId,
    content: newDoc.message,
    messageType: newDoc.messageType,
    fileUrl: newDoc.fileUrl,
    sender: {
      userId: newDoc.senderId,
      userType: newDoc.senderType
    },
    status: newDoc.status,
    readAt: newDoc.readAt,
    createdAt: newDoc.createdAt,
    updatedAt: newDoc.updatedAt
  };

  chat.lastMessage = savedMessage;
  await chat.save();

  // Emit to active chat room and both users' private rooms for reliable delivery.
  if (req.io) {
    req.io.to(chatId).emit('message:receive', savedMessage);
    req.io.to(`user_${currentUser}`).emit('message:receive', savedMessage);
    req.io.to(`user_${receiverId}`).emit('message:receive', savedMessage);
  }

  return res.status(201).json(new ApiResponse(201, savedMessage, "Message sent successfully"));
});

// Get chat messages with pagination
const getChatMessages = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, "Chat not found");
  }

  // Verify user is participant
  const currentUser = req.doctor ? req.doctor._id : req.client._id;
  const isParticipant = chat.participants.some(p => p.userId.toString() === currentUser.toString());

  if (!isParticipant) {
    throw new ApiError(403, "You are not a participant in this chat");
  }

  const skip = (page - 1) * limit;
  const totalMessages = await Message.countDocuments({ chatId });

  const messageDocs = await Message.find({ chatId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('senderId', 'name avatar');

  const messages = messageDocs.map(doc => ({
    _id: doc._id,
    chatId: doc.chatId,
    content: doc.message,
    messageType: doc.messageType,
    fileUrl: doc.fileUrl,
    sender: {
      userId: doc.senderId,
      userType: doc.senderType
    },
    status: doc.status,
    readAt: doc.readAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  })).reverse();

  return res.status(200).json(new ApiResponse(200, {
    messages: messages,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalMessages / limit),
      totalMessages,
      hasMore: skip + limit < totalMessages
    }
  }, "Messages retrieved successfully"));
});

// Mark messages as read
const markMessagesAsRead = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const { messageIds = [] } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, "Chat not found");
  }

  const currentUser = req.doctor ? req.doctor._id : req.client._id;
  const userType = req.doctor ? 'Doctor' : 'Client';

  // Mark specified messages as read
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(200).json(new ApiResponse(200, {}, "No messages to mark as read"));
  }

  await Message.updateMany(
    {
      _id: { $in: messageIds },
      chatId,
      senderId: { $ne: currentUser },
      receiverId: currentUser
    },
    { $set: { status: 'read', readAt: new Date() } }
  );

  // Emit read receipt to chat room and participant rooms.
  if (req.io) {
    req.io.to(chatId).emit('message:read', {
      chatId,
      readBy: { userId: currentUser, userType },
      messageIds
    });

    const otherParticipant = chat.participants.find(
      (p) => p.userId.toString() !== currentUser.toString()
    );

    req.io.to(`user_${currentUser}`).emit('message:read', {
      chatId,
      readBy: { userId: currentUser, userType },
      messageIds
    });

    if (otherParticipant) {
      req.io.to(`user_${otherParticipant.userId}`).emit('message:read', {
        chatId,
        readBy: { userId: currentUser, userType },
        messageIds
      });
    }
  }

  return res.status(200).json(new ApiResponse(200, {}, "Messages marked as read"));
});

// Delete message
const deleteMessage = asyncHandler(async (req, res) => {
  const { chatId, messageId } = req.params;

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, "Chat not found");
  }

  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  const currentUser = req.doctor ? req.doctor._id : req.client._id;
  if (message.senderId.toString() !== currentUser.toString()) {
    throw new ApiError(403, "You can only delete your own messages");
  }

  // Check if message is within 5 minutes of sending
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (new Date(message.createdAt) < fiveMinutesAgo) {
    throw new ApiError(400, "Message can only be deleted within 5 minutes of sending");
  }

  await message.deleteOne();

  // Emit socket event
  if (req.io) {
    req.io.to(chatId).emit('message:deleted', {
      chatId,
      messageId,
      deletedBy: currentUser
    });

    const otherParticipant = chat.participants.find(
      (p) => p.userId.toString() !== currentUser.toString()
    );

    req.io.to(`user_${currentUser}`).emit('message:deleted', {
      chatId,
      messageId,
      deletedBy: currentUser
    });

    if (otherParticipant) {
      req.io.to(`user_${otherParticipant.userId}`).emit('message:deleted', {
        chatId,
        messageId,
        deletedBy: currentUser
      });
    }
  }

  return res.status(200).json(new ApiResponse(200, {}, "Message deleted successfully"));
});

export {
  createOrGetChat,
  getUserChats,
  sendMessage,
  getChatMessages,
  markMessagesAsRead,
  deleteMessage
};