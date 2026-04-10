import React, { useState, useEffect, useRef } from 'react';
import { Search, Send, Phone, Video, MoreVertical, ArrowLeft, Users, MessageCircle, Trash2, Eye, EyeOff, Smile, Paperclip, Check, CheckCheck } from 'lucide-react';
import useChatStore from '../store/chatStore';
import useDoctorAuthStore from '../store/doctorAuthStore';
import useClientAuthStore from '../store/clientAuthStore';
import { Link } from 'react-router-dom';
import EmojiPicker from 'emoji-picker-react';

const ChatPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showContactList, setShowContactList] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [userType, setUserType] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const emojiPickerRef = useRef(null);

  // Chat store
  const {
    chats,
    currentChat,
    messages,
    isLoading,
    error,
    isConnected,
    unreadCount,
    pagination,
    connectSocket,
    disconnectSocket,
    fetchUserChats,
    createOrGetChat,
    sendMessage,
    getChatMessages,
    setCurrentChat,
    clearCurrentChat,
    markMessagesAsRead,
    deleteMessage,
    clearError,
    setError,
    startTyping,
    stopTyping,
    isMessageFromCurrentUser,
    getFormattedChats,
    updateChatWithNewMessage,
    typingUsers,
    onlineUsers,
    getChatParticipant
  } = useChatStore();

  // Auth stores
  const {
    doctor,
    isAuthenticated: isDoctorAuthenticated,
    getAllDoctors,
    checkAuth: checkDoctorAuth
  } = useDoctorAuthStore();

  const {
    client,
    isAuthenticated: isClientAuthenticated,
    getAllClients,
    checkAuth: checkClientAuth
  } = useClientAuthStore();

  const getCurrentUserId = () => {
    return currentUser?._id;
  };

  useEffect(() => {
    const initializeUser = async () => {
      try {
        const doctorToken = localStorage.getItem('doctorAccessToken');
        const clientToken = localStorage.getItem('clientAccessToken');

        if (doctorToken) {
          setUserType('Doctor');
          const docId = localStorage.getItem('doctorId');
          if (doctor && doctor._id) {
            setCurrentUser(doctor);
          } else if (docId) {
            setCurrentUser({ _id: docId });
          }
          return;
        }

        if (clientToken) {
          setUserType('Client');
          const clientId = localStorage.getItem('clientId');
          if (client && client._id) {
            setCurrentUser(client);
          } else if (clientId) {
            setCurrentUser({ _id: clientId });
          }
          return;
        }
      } catch (error) {
        console.error("Error initializing user:", error);
      }
    };

    initializeUser();
  }, [doctor, client]);

  useEffect(() => {
    if (userType) {
      connectSocket();
      fetchUserChats();
      fetchContacts();
    }
    return () => {
      disconnectSocket();
    };
  }, [userType, connectSocket, disconnectSocket, fetchUserChats]);

  useEffect(() => {
    if (currentChat && messages.length > 0) {
      const unreadMessages = messages.filter(msg => {
        const currentUserId = getCurrentUserId();
        return !isMessageFromCurrentUser(msg, currentUserId) && msg.status !== 'read';
      });

      if (unreadMessages.length > 0) {
        const messageIds = unreadMessages.map(msg => msg._id);
        markMessagesAsRead(currentChat._id, messageIds);
      }
    }
  }, [currentChat, messages, markMessagesAsRead, isMessageFromCurrentUser]);

  const [loading, setLoading] = useState(false);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      if (userType === 'Client') {
        const result = await getAllDoctors({ verified: 'true' });
        if (result.success) setContacts(result.data);
      } else if (userType === 'Doctor') {
        const result = await getAllClients();
        if (result.success) setContacts(result.data);
      }
    } catch (error) {
      setError('Failed to fetch contacts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const scrollToBottom = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    };
    setTimeout(scrollToBottom, 100);
  }, [messages]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleContactSelect = async (contact) => {
    try {
      const participantType = userType === 'Client' ? 'Doctor' : 'Client';
      await createOrGetChat(contact._id, participantType);
      setSelectedChat(contact);
      setShowContactList(false);
    } catch (error) {
      setError('Failed to create chat');
    }
  };

  const handleChatSelect = async (chat) => {
    try {
      if (!chat || !chat._id || !userType) return;
      setCurrentChat(chat);
      await getChatMessages(chat._id);

      const currentUserId = getCurrentUserId();
      const otherParticipant = getChatParticipant(chat, currentUserId);

      if (!otherParticipant || !otherParticipant.userId) return;

      setSelectedChat(otherParticipant.userId);
      setShowContactList(false);
    } catch (error) {
      setError('Failed to load chat');
    }
  };

  const handleTypingStart = () => {
    if (currentChat && !isTyping) {
      setIsTyping(true);
      startTyping(currentChat._id);
    }
  };

  const handleTypingStop = () => {
    if (currentChat && isTyping) {
      setIsTyping(false);
      stopTyping(currentChat._id);
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || !currentChat) return;

    try {
      handleTypingStop();
      const messageType = selectedFile ?
        (selectedFile.type.startsWith('image/') ? 'image' : 'file') : 'text';

      await sendMessage(currentChat._id, newMessage.trim(), messageType, selectedFile);
      setNewMessage('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowEmojiPicker(false);
    } catch (error) {
      setError('Failed to send message');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    try {
      await deleteMessage(currentChat._id, messageId);
      setShowDeleteConfirm(false);
      setMessageToDelete(null);
    } catch (error) {
      setError('Failed to delete message');
    }
  };

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (e.target.value.trim() && currentChat) {
      handleTypingStart();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        handleTypingStop();
      }, 2000);
    } else {
      handleTypingStop();
    }
  };

  const onEmojiClick = (emojiObject) => {
    setNewMessage(prev => prev + emojiObject.emoji);
  };

  const loadMoreMessages = async () => {
    if (currentChat && pagination.hasMore && !isLoading) {
      try {
        await getChatMessages(currentChat._id, pagination.currentPage + 1);
      } catch (error) {
        setError('Failed to load more messages');
      }
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.specialization?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const currentUserId = getCurrentUserId();
  const formattedChats = getFormattedChats(currentUserId);
  const filteredChats = formattedChats.filter(chat =>
    chat.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  if (!userType) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f0f2f5]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-[#00a884]"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#ece5dd] font-sans text-slate-900">
      <div className="w-full max-w-[1600px] mx-auto flex py-0 md:py-6 md:px-6 h-full shadow-lg">

        {/* Left Sidebar */}
        <div className={`${showContactList ? 'w-full md:w-[30%] min-w-[320px]' : 'hidden md:flex md:w-[30%] min-w-[320px]'} flex-col bg-white border-r border-gray-200`}>
          {/* Header Profile */}
          <div className="flex items-center justify-between bg-[#f0f2f5] p-3 border-b border-gray-200">
            {currentUser && (
              <div className="flex items-center gap-3">
                <img
                  src={currentUser.avatar || currentUser.profileImage || `https://ui-avatars.com/api/?name=${currentUser.name}&background=00a884&color=fff`}
                  alt={currentUser.name}
                  className="w-10 h-10 rounded-full object-cover cursor-pointer"
                />
                <span className="font-semibold text-gray-800 hidden lg:block">{currentUser.name}</span>
              </div>
            )}
            <div className="flex gap-4 text-gray-500">
              <button onClick={fetchUserChats}><Users className="w-5 h-5" /></button>
              <button><MessageCircle className="w-5 h-5" /></button>
              <button><MoreVertical className="w-5 h-5" /></button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white p-2 border-b border-gray-200">
            <div className="flex items-center bg-[#f0f2f5] rounded-lg px-3 py-1.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-[#00a884] shadow-sm">
              <Search className="w-5 h-5 text-gray-500 mr-3" />
              <input
                type="text"
                placeholder="Search or start new chat"
                className="w-full bg-transparent outline-none text-sm text-gray-900 placeholder-gray-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto bg-white">
            {filteredChats.length > 0 && filteredChats.map((chat) => (
              <div
                key={chat._id}
                onClick={() => handleChatSelect(chat)}
                className={`flex items-center px-3 py-3 hover:bg-[#f5f6f6] cursor-pointer transition-colors border-b border-gray-100 ${currentChat?._id === chat._id ? 'bg-[#f0f2f5]' : ''}`}
              >
                <img
                  src={chat.displayAvatar || `https://ui-avatars.com/api/?name=${chat.displayName}&background=00a884&color=fff`}
                  alt={chat.displayName}
                  className="w-12 h-12 rounded-full object-cover"
                />
                <div className="ml-3 flex-1 overflow-hidden">
                  <div className="flex justify-between items-baseline mb-1">
                    <h3 className="text-[16px] font-normal text-gray-900 truncate">{chat.displayName}</h3>
                    <span className="text-[12px] text-gray-500">
                      {new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[13px] text-gray-500 truncate w-full pr-4">{chat.lastMessagePreview}</p>
                    {chat.unreadCount > 0 && (
                      <span className="bg-[#00a884] text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {filteredChats.length === 0 && contacts.length > 0 && (
              <div className="p-4">
                <p className="text-xs font-semibold text-[#00a884] mb-3 uppercase tracking-wide">Contacts</p>
                {filteredContacts.map((contact) => (
                  <div
                    key={contact._id}
                    onClick={() => handleContactSelect(contact)}
                    className="flex items-center py-2 hover:bg-[#f5f6f6] cursor-pointer"
                  >
                    <img
                      src={contact.avatar || contact.profileImage || `https://ui-avatars.com/api/?name=${contact.name}&background=00a884&color=fff`}
                      alt={contact.name}
                      className="w-10 h-10 rounded-full"
                    />
                    <div className="ml-3">
                      <p className="text-sm text-gray-900">{contact.name}</p>
                      <p className="text-xs text-gray-500">{contact.specialization || contact.gender}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Chat Area */}
        <div className={`${showContactList ? 'hidden md:flex' : 'flex'} flex-1 flex-col relative`}>
          {selectedChat ? (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between bg-[#f0f2f5] p-3 border-b border-gray-200 h-[60px]">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setShowContactList(true); clearCurrentChat(); }} className="md:hidden text-gray-500">
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                  <img
                    src={selectedChat.avatar || selectedChat.profileImage || `https://ui-avatars.com/api/?name=${selectedChat.name}&background=00a884&color=fff`}
                    alt={selectedChat.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <h3 className="text-[16px] font-normal text-gray-900">{selectedChat.name}</h3>
                    <p className="text-[13px] text-gray-500">
                      {typingUsers[selectedChat._id]
                        ? <span className="text-[#00a884] font-medium">typing...</span>
                        : (onlineUsers.some(u => u.userId === selectedChat._id)
                          ? <span className="text-[#00a884] font-medium">Online</span>
                          : 'click here for contact info')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-gray-500">
                  <Search className="w-5 h-5 hover:text-gray-700 transition cursor-pointer" />
                  <MoreVertical className="w-5 h-5 hover:text-gray-700 transition cursor-pointer" />
                </div>
              </div>

              {/* Chat View */}
              <div
                className="flex-1 overflow-y-auto p-5"
                style={{
                  backgroundImage: `url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")`,
                  backgroundRepeat: 'repeat',
                  backgroundColor: '#efeae2',
                  backgroundSize: '400px'
                }}
              >
                {pagination.hasMore && (
                  <div className="flex justify-center mb-4">
                    <button onClick={loadMoreMessages} disabled={isLoading} className="bg-white px-3 py-1 rounded-full text-xs text-gray-600 shadow-sm">
                      {isLoading ? 'Loading...' : 'Load more messages'}
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  {(() => {
                    let lastDate = null;
                    return [...messages]
                      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                      .map((message) => {
                        const currentId = getCurrentUserId();
                        const msgSenderId = message?.sender?.userId?._id || message?.sender?.userId || message?.senderId || message?.sender || 'unknown';
                        const isOwn = String(msgSenderId) === String(currentId);
                        const msgDate = new Date(message.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                        const showDateHeader = lastDate !== msgDate;
                        lastDate = msgDate;

                        return (
                          <React.Fragment key={message._id}>
                            {showDateHeader && (
                              <div className="flex justify-center my-3 relative z-10 w-full mb-4 mt-2">
                                <span className="bg-[#e1f3fb] px-4 py-1.5 rounded-lg text-[11.5px] font-semibold text-gray-600 shadow-sm uppercase tracking-wide relative">
                                  {msgDate}
                                </span>
                              </div>
                            )}
                            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} w-full`}>
                              <div className={`relative max-w-[75%] px-3.5 py-2 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-[14.5px] leading-relaxed ${isOwn ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none border border-gray-100'
                                }`}>

                                {/* Message Type Check */}
                                {message.messageType === 'image' && message.fileUrl ? (
                                  <div className="mb-1">
                                    <img src={message.fileUrl} alt="Shared" className="rounded max-h-64 object-cover cursor-pointer" onClick={() => window.open(message.fileUrl, '_blank')} />
                                    {message.content && <p className="mt-1 text-slate-900">{message.content}</p>}
                                  </div>
                                ) : message.messageType === 'file' && message.fileUrl ? (
                                  <div className="flex items-center space-x-2 bg-black/5 p-2 rounded mb-1">
                                    <Paperclip className="w-6 h-6 text-gray-600" />
                                    <div className="flex-1 overflow-hidden">
                                      <p className="text-sm font-medium truncate text-slate-900">{message.fileName || 'Document'}</p>
                                    </div>
                                    <a href={message.fileUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-800"><Eye className="w-4 h-4" /></a>
                                  </div>
                                ) : (
                                  <p className="text-slate-900 whitespace-pre-wrap leading-tight">{message.content}</p>
                                )}

                                {/* Timestamp and Checkmarks */}
                                <div className="flex items-center justify-end gap-1 mt-1 font-sans">
                                  <span className="text-[11px] text-gray-500">
                                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {isOwn && (
                                    <span className={`text-[12px] ${message.status === 'read' ? 'text-[#53bdeb]' : 'text-gray-500'}`}>
                                      {message.status === 'sent' ? <Check className="w-[14px] h-[14px]" /> : <CheckCheck className="w-[14px] h-[14px]" />}
                                    </span>
                                  )}
                                </div>

                                {/* Bubble Tail */}
                                <div className={`absolute top-0 w-4 h-4 ${isOwn ? '-right-[8px] bg-[#d9fdd3] drop-shadow-none' : '-left-[8px] bg-white border-l border-t border-gray-100 drop-shadow-none'
                                  }`} style={{ clipPath: isOwn ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(0 0, 100% 0, 100% 100%)' }} />
                              </div>
                            </div>
                          </React.Fragment>
                        )
                      });
                  })()}
                </div>
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Section */}
              <div className="bg-[#f0f2f5] px-4 py-3 flex items-end gap-3 z-10 relative">
                {/* File Preview before sending */}
                {selectedFile && (
                  <div className="absolute bottom-[100%] left-0 w-full bg-white p-3 border-b flex items-center justify-between shadow-lg text-slate-900">
                    <div className="flex items-center">
                      <Paperclip className="w-5 h-5 mr-2 text-gray-500" />
                      <span className="text-sm truncate max-w-xs">{selectedFile.name}</span>
                    </div>
                    <button onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Emoji Picker absolute container */}
                {showEmojiPicker && (
                  <div ref={emojiPickerRef} className="absolute bottom-[60px] left-2">
                    <EmojiPicker onEmojiClick={onEmojiClick} searchDisabled skinTonesDisabled />
                  </div>
                )}

                <div className="flex items-center justify-center text-gray-500 gap-2 mb-1">
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-black/5 transition">
                    <Smile className="w-[26px] h-[26px]" />
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-black/5 transition -rotate-45">
                    <Paperclip className="w-[24px] h-[24px]" />
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*,.pdf,.doc,.docx" />
                </div>

                <div className="flex-1 bg-white rounded-lg flex items-center pb-1 pt-1.5 px-3 min-h-[44px]">
                  <textarea
                    value={newMessage}
                    onChange={handleInputChange}
                    placeholder="Type a message"
                    className="w-full bg-transparent outline-none max-h-[100px] resize-none text-[15px] text-slate-900 placeholder:text-gray-500 pt-1"
                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-center mb-1">
                  {(newMessage.trim() || selectedFile) ? (
                    <button onClick={handleSendMessage} className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#008f6f] transition">
                      <Send className="w-[20px] h-[20px] ml-1" />
                    </button>
                  ) : (
                    <button className="w-[44px] h-[44px] flex items-center justify-center rounded-full text-gray-500 hover:bg-black/5 transition">
                      {/* Microphone icon could go here instead of send if empty */}
                      <Send className="w-[20px] h-[20px]" />
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] border-l border-gray-200">
              <div className="max-w-md text-center">
                <div className="bg-[#00a884] w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 text-white opacity-90">
                  <MessageCircle className="w-12 h-12" />
                </div>
                <h1 className="text-3xl font-light text-gray-700 mb-4">MediConnect Desktop</h1>
                <p className="text-[14px] text-gray-500 leading-relaxed mb-8">
                  Send and receive messages without keeping your phone online.<br />
                  Reach out to your verified contacts for secure health consultations.
                </p>
                <div className="flex justify-center text-gray-400 text-sm">
                  <span className="flex items-center gap-1"><Check className="w-4 h-4" /> End-to-end encrypted</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;