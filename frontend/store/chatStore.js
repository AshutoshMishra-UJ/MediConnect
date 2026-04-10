import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const getAuthContext = () => {
    const doctorToken = localStorage.getItem('doctorAccessToken');
    const clientToken = localStorage.getItem('clientAccessToken');
    const doctorId = localStorage.getItem('doctorId');
    const clientId = localStorage.getItem('clientId');

    if (doctorToken && doctorId && !clientToken) {
        return { token: doctorToken, userId: doctorId, userType: 'Doctor' };
    }

    if (clientToken && clientId && !doctorToken) {
        return { token: clientToken, userId: clientId, userType: 'Client' };
    }

    if (doctorToken && doctorId) {
        return { token: doctorToken, userId: doctorId, userType: 'Doctor' };
    }

    if (clientToken && clientId) {
        return { token: clientToken, userId: clientId, userType: 'Client' };
    }

    return null;
};

const authHeaders = () => {
    const auth = getAuthContext();
    if (!auth?.token) {
        throw new Error('No authentication token found');
    }

    return {
        Authorization: `Bearer ${auth.token}`,
    };
};

const normalizeMessage = (message) => {
    if (!message) return null;

    const senderUserId = message.sender?.userId?._id || message.sender?.userId || message.senderId;

    return {
        _id: message._id,
        chatId: String(message.chatId),
        content: message.content ?? message.message ?? '',
        messageType: message.messageType || 'text',
        fileUrl: message.fileUrl || null,
        sender: {
            userId: senderUserId,
            userType: message.sender?.userType || message.senderType,
        },
        status: message.status || 'sent',
        readAt: message.readAt || null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
    };
};

const useChatStore = create(
    devtools((set, get) => ({
        socket: null,
        chats: [],
        currentChat: null,
        messages: [],
        isLoading: false,
        error: null,
        isConnected: false,
        unreadCount: 0,
        onlineUsers: [],
        typingUsers: {},
        pagination: {
            currentPage: 1,
            totalPages: 1,
            totalMessages: 0,
            hasMore: false,
        },

        connectSocket: () => {
            const { socket, isConnected } = get();
            if (socket && isConnected) return;

            const auth = getAuthContext();
            if (!auth?.token || !auth?.userId || !auth?.userType) {
                set({ error: 'Missing authentication context for chat socket' });
                return;
            }

            if (socket) {
                socket.disconnect();
            }

            const newSocket = io(API_BASE, {
                auth: {
                    token: auth.token,
                    userId: auth.userId,
                    userType: auth.userType,
                },
                transports: ['websocket', 'polling'],
                withCredentials: true,
            });

            newSocket.on('connect', () => {
                set({ isConnected: true, socket: newSocket, error: null });
                const { currentChat } = get();
                if (currentChat?._id) {
                    newSocket.emit('joinChat', currentChat._id);
                }
            });

            newSocket.on('disconnect', () => {
                set({ isConnected: false });
            });

            newSocket.on('connect_error', (err) => {
                set({ error: `Socket error: ${err.message}` });
            });

            newSocket.on('message:receive', (rawMessage) => {
                const message = normalizeMessage(rawMessage);
                if (!message) return;

                const { messages, currentChat } = get();
                const isActiveChat = currentChat?._id && String(currentChat._id) === String(message.chatId);

                if (isActiveChat) {
                    const exists = messages.some((m) => String(m._id) === String(message._id));
                    if (!exists) {
                        set({ messages: [...messages, message] });
                    }
                }

                get().updateChatWithNewMessage(message);
            });

            newSocket.on('message:read', ({ messageIds = [] }) => {
                if (!Array.isArray(messageIds) || messageIds.length === 0) return;

                set((state) => ({
                    messages: state.messages.map((m) =>
                        messageIds.includes(m._id) ? { ...m, status: 'read', readAt: m.readAt || new Date().toISOString() } : m
                    ),
                }));
            });

            newSocket.on('message:deleted', ({ messageId }) => {
                if (!messageId) return;
                set((state) => ({
                    messages: state.messages.filter((m) => String(m._id) !== String(messageId)),
                }));
            });

            newSocket.on('typing:start', ({ userId }) => {
                set((state) => ({
                    typingUsers: { ...state.typingUsers, [userId]: true },
                }));
            });

            newSocket.on('typing:stop', ({ userId }) => {
                set((state) => ({
                    typingUsers: { ...state.typingUsers, [userId]: false },
                }));
            });

            newSocket.on('users:online_list', (users) => {
                set({ onlineUsers: Array.isArray(users) ? users : [] });
            });

            newSocket.on('user:online', (user) => {
                set((state) => {
                    const exists = state.onlineUsers.some((u) => String(u.userId) === String(user.userId));
                    if (exists) return state;
                    return { onlineUsers: [...state.onlineUsers, user] };
                });
            });

            newSocket.on('user:offline', ({ userId }) => {
                set((state) => ({
                    onlineUsers: state.onlineUsers.filter((u) => String(u.userId) !== String(userId)),
                }));
            });

            newSocket.emit('getOnlineUsers');
            set({ socket: newSocket });
        },

        disconnectSocket: () => {
            const { socket } = get();
            if (socket) {
                socket.disconnect();
            }
            set({ socket: null, isConnected: false, typingUsers: {} });
        },

        fetchUserChats: async () => {
            set({ isLoading: true, error: null });
            try {
                const response = await axios.get(`${API_BASE}/chats/user-chats`, {
                    headers: authHeaders(),
                    withCredentials: true,
                });

                const chats = response.data?.data || [];
                const sortedChats = [...chats].sort((a, b) => {
                    const aTime = new Date(a?.lastMessage?.createdAt || a?.updatedAt || a?.createdAt || 0).getTime();
                    const bTime = new Date(b?.lastMessage?.createdAt || b?.updatedAt || b?.createdAt || 0).getTime();
                    return bTime - aTime;
                });

                const unreadCount = sortedChats.reduce((acc, chat) => acc + (chat.unreadCount || 0), 0);

                set({ chats: sortedChats, unreadCount });
                return sortedChats;
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to load chats';
                set({ error: message });
                throw error;
            } finally {
                set({ isLoading: false });
            }
        },

        createOrGetChat: async (participantId, participantType) => {
            set({ isLoading: true, error: null });
            try {
                const response = await axios.post(
                    `${API_BASE}/chats/create-or-get`,
                    { participantId, participantType },
                    {
                        headers: authHeaders(),
                        withCredentials: true,
                    }
                );

                const chat = response.data?.data;
                if (!chat?._id) {
                    throw new Error('Invalid chat response');
                }

                const { socket } = get();
                if (socket?.connected) {
                    socket.emit('joinChat', chat._id);
                }

                set({ currentChat: chat, messages: [] });
                await get().getChatMessages(chat._id, 1, 50);
                await get().fetchUserChats();

                return chat;
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to create chat';
                set({ error: message });
                throw error;
            } finally {
                set({ isLoading: false });
            }
        },

        getChatMessages: async (chatId, page = 1, limit = 50) => {
            set({ isLoading: true, error: null });
            try {
                const response = await axios.get(`${API_BASE}/chats/${chatId}/messages`, {
                    params: { page, limit },
                    headers: authHeaders(),
                    withCredentials: true,
                });

                const payload = response.data?.data || {};
                const receivedMessages = (payload.messages || []).map(normalizeMessage).filter(Boolean);
                const pagination = payload.pagination || {
                    currentPage: 1,
                    totalPages: 1,
                    totalMessages: receivedMessages.length,
                    hasMore: false,
                };

                if (page === 1) {
                    set({ messages: receivedMessages, pagination });
                } else {
                    set((state) => ({
                        messages: [...receivedMessages, ...state.messages],
                        pagination,
                    }));
                }

                const { socket, currentChat } = get();
                if (socket?.connected && currentChat?._id === chatId) {
                    socket.emit('joinChat', chatId);
                }

                return { messages: receivedMessages, pagination };
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to fetch messages';
                set({ error: message });
                throw error;
            } finally {
                set({ isLoading: false });
            }
        },

        sendMessage: async (chatId, content, messageType = 'text', file = null) => {
            const trimmed = (content || '').trim();
            if (!trimmed && !file) {
                return null;
            }

            set({ isLoading: true, error: null });
            try {
                const formData = new FormData();
                formData.append('chatId', chatId);
                formData.append('content', trimmed);
                formData.append('messageType', file ? (file.type?.startsWith('image/') ? 'image' : 'file') : messageType);

                if (file) {
                    formData.append('file', file);
                }

                const response = await axios.post(`${API_BASE}/chats/send-message`, formData, {
                    headers: {
                        ...authHeaders(),
                    },
                    withCredentials: true,
                });

                const message = normalizeMessage(response.data?.data);
                if (!message) {
                    throw new Error('Invalid message response');
                }

                set((state) => {
                    const exists = state.messages.some((m) => String(m._id) === String(message._id));
                    return {
                        messages: exists ? state.messages : [...state.messages, message],
                    };
                });

                get().updateChatWithNewMessage(message);
                return message;
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to send message';
                set({ error: message });
                throw error;
            } finally {
                set({ isLoading: false });
            }
        },

        markMessagesAsRead: async (chatId, messageIds) => {
            if (!Array.isArray(messageIds) || messageIds.length === 0) return;

            try {
                await axios.patch(
                    `${API_BASE}/chats/${chatId}/mark-read`,
                    { messageIds },
                    {
                        headers: authHeaders(),
                        withCredentials: true,
                    }
                );

                set((state) => ({
                    messages: state.messages.map((m) =>
                        messageIds.includes(m._id) ? { ...m, status: 'read', readAt: m.readAt || new Date().toISOString() } : m
                    ),
                }));
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to mark messages as read';
                set({ error: message });
            }
        },

        deleteMessage: async (chatId, messageId) => {
            set({ isLoading: true, error: null });
            try {
                await axios.delete(`${API_BASE}/chats/${chatId}/messages/${messageId}`, {
                    headers: authHeaders(),
                    withCredentials: true,
                });

                set((state) => ({
                    messages: state.messages.filter((m) => String(m._id) !== String(messageId)),
                }));
            } catch (error) {
                const message = error.response?.data?.message || 'Failed to delete message';
                set({ error: message });
                throw error;
            } finally {
                set({ isLoading: false });
            }
        },

        setCurrentChat: (chat) => {
            const { socket, currentChat } = get();

            if (socket?.connected && currentChat?._id) {
                socket.emit('leaveChat', currentChat._id);
            }

            set({ currentChat: chat, messages: [], pagination: { currentPage: 1, totalPages: 1, totalMessages: 0, hasMore: false } });

            if (socket?.connected && chat?._id) {
                socket.emit('joinChat', chat._id);
            }
        },

        clearCurrentChat: () => {
            const { socket, currentChat } = get();
            if (socket?.connected && currentChat?._id) {
                socket.emit('leaveChat', currentChat._id);
            }
            set({ currentChat: null, messages: [] });
        },

        updateChatWithNewMessage: (message) => {
            if (!message?.chatId) return;

            set((state) => {
                const updated = state.chats.map((chat) => {
                    if (String(chat._id) !== String(message.chatId)) return chat;

                    return {
                        ...chat,
                        lastMessage: {
                            content: message.content,
                            createdAt: message.createdAt,
                            sender: message.sender,
                        },
                        updatedAt: message.createdAt,
                    };
                });

                updated.sort((a, b) => {
                    const aTime = new Date(a?.lastMessage?.createdAt || a?.updatedAt || a?.createdAt || 0).getTime();
                    const bTime = new Date(b?.lastMessage?.createdAt || b?.updatedAt || b?.createdAt || 0).getTime();
                    return bTime - aTime;
                });

                return { chats: updated };
            });
        },

        startTyping: (chatId) => {
            const { socket } = get();
            if (socket?.connected && chatId) {
                socket.emit('typing:start', { chatId });
            }
        },

        stopTyping: (chatId) => {
            const { socket } = get();
            if (socket?.connected && chatId) {
                socket.emit('typing:stop', { chatId });
            }
        },

        getChatParticipant: (chat, currentUserId) => {
            if (!chat?.participants || !currentUserId) return null;
            return chat.participants.find((p) => {
                const participantId = p?.userId?._id || p?.userId;
                return String(participantId) !== String(currentUserId);
            });
        },

        isMessageFromCurrentUser: (message, currentUserId) => {
            if (!message || !currentUserId) return false;
            const senderId = message.sender?.userId?._id || message.sender?.userId || message.senderId;
            return String(senderId) === String(currentUserId);
        },

        getFormattedChats: (currentUserId) => {
            const { chats } = get();
            return chats.map((chat) => {
                const otherParticipant = get().getChatParticipant(chat, currentUserId);
                return {
                    ...chat,
                    displayName: otherParticipant?.userId?.name || 'Unknown User',
                    displayAvatar: otherParticipant?.userId?.avatar || otherParticipant?.userId?.profileImage || null,
                    lastMessagePreview: chat?.lastMessage?.content || 'No messages yet',
                    lastMessageTime: chat?.lastMessage?.createdAt || chat?.updatedAt || chat?.createdAt,
                };
            });
        },

        clearError: () => set({ error: null }),
        setError: (error) => set({ error }),
    }))
);

export default useChatStore;
