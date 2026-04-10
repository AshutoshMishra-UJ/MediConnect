import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import {
    ArrowLeft,
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Search,
    Video,
    VideoOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import useDoctorAuthStore from '../store/doctorAuthStore';
import useClientAuthStore from '../store/clientAuthStore';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

const VIDEO_CONSTRAINTS = {
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    },
};

function VideoPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [contacts, setContacts] = useState([]);
    const [loadingContacts, setLoadingContacts] = useState(false);

    const [currentUser, setCurrentUser] = useState(null);
    const [userType, setUserType] = useState(null);

    const [selectedContact, setSelectedContact] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);
    const [remoteUserId, setRemoteUserId] = useState(null);

    const [callState, setCallState] = useState('idle');
    const [statusText, setStatusText] = useState('Ready');
    const [errorText, setErrorText] = useState('');

    const [cameraEnabled, setCameraEnabled] = useState(true);
    const [micEnabled, setMicEnabled] = useState(true);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    const socketRef = useRef(null);
    const peerRef = useRef(null);
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);
    const remoteUserIdRef = useRef(null);
    const pendingIceRef = useRef([]);

    const {
        doctor,
        checkAuth: checkDoctorAuth,
        getAllDoctors,
    } = useDoctorAuthStore();

    const {
        client,
        checkAuth: checkClientAuth,
        getAllClients,
    } = useClientAuthStore();

    const displayContacts = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return contacts;

        return contacts.filter((c) => {
            return (
                c?.name?.toLowerCase().includes(q) ||
                c?.email?.toLowerCase().includes(q) ||
                c?.specialization?.toLowerCase().includes(q)
            );
        });
    }, [contacts, searchTerm]);

    const resetCallState = (keepSelection = true) => {
        setCallState('idle');
        setStatusText('Ready');
        setIncomingCall(null);
        setRemoteUserId(null);
        remoteUserIdRef.current = null;
        pendingIceRef.current = [];

        if (!keepSelection) {
            setSelectedContact(null);
        }
    };

    const stopTracks = (stream) => {
        if (!stream) return;
        stream.getTracks().forEach((track) => track.stop());
    };

    const closePeerConnection = () => {
        if (peerRef.current) {
            peerRef.current.onicecandidate = null;
            peerRef.current.ontrack = null;
            peerRef.current.onconnectionstatechange = null;
            peerRef.current.close();
            peerRef.current = null;
        }
    };

    const fullCleanup = () => {
        closePeerConnection();

        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }

        if (remoteStreamRef.current) {
            stopTracks(remoteStreamRef.current);
            remoteStreamRef.current = null;
        }

        if (localStreamRef.current) {
            stopTracks(localStreamRef.current);
            localStreamRef.current = null;
        }

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }

        setCameraEnabled(true);
        setMicEnabled(true);
        resetCallState(true);
    };

    const ensureLocalMedia = async () => {
        if (localStreamRef.current?.active) {
            return localStreamRef.current;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
            localStreamRef.current = stream;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.muted = true;
                await localVideoRef.current.play().catch(() => { });
            }

            setCameraEnabled(true);
            setMicEnabled(true);
            return stream;
        } catch (err) {
            const message = 'Camera or microphone access denied.';
            setErrorText(message);
            toast.error(message);
            throw err;
        }
    };

    const createPeer = () => {
        closePeerConnection();

        const peer = new RTCPeerConnection(RTC_CONFIG);
        peerRef.current = peer;
        peer.ontrack = (event) => {
            const [remoteStream] = event.streams;
            if (!remoteStream) return;
            remoteStreamRef.current = remoteStream;

            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStream;
                remoteVideoRef.current
                    .play()
                    .then(() => {
                        setCallState('in-call');
                        setStatusText('Connected');
                    })
                    .catch(() => {
                        setCallState('in-call');
                        setStatusText('Connected');
                    });
            }
        };

        peer.onicecandidate = (event) => {
            const targetUserId = remoteUserIdRef.current;
            if (!event.candidate || !socketRef.current || !targetUserId) {
                return;
            }

            socketRef.current.emit('video:ice-candidate', {
                toUserId: targetUserId,
                candidate: event.candidate,
            });
        };

        peer.onconnectionstatechange = () => {
            const state = peer.connectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                setStatusText('Connection ended');
            }
        };

        return peer;
    };

    const addLocalTracks = (peer, stream) => {
        stream.getTracks().forEach((track) => {
            peer.addTrack(track, stream);
        });
    };

    const flushPendingIce = async () => {
        if (!peerRef.current?.remoteDescription || pendingIceRef.current.length === 0) {
            return;
        }

        const queue = [...pendingIceRef.current];
        pendingIceRef.current = [];

        for (const candidate of queue) {
            try {
                await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {
                // Drop malformed or stale candidates.
            }
        }
    };

    const setupSocket = (token, currentUserId, currentUserType) => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        const socket = io(SOCKET_URL, {
            auth: {
                token,
                userId: currentUserId,
                userType: currentUserType,
            },
            transports: ['websocket', 'polling'],
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            setStatusText('Ready');
            setErrorText('');
        });

        socket.on('connect_error', () => {
            setErrorText('Socket connection failed. Please refresh and login again.');
        });

        socket.on('video:incoming-call', (payload) => {
            setIncomingCall(payload);
            setRemoteUserId(payload.fromUserId);
            remoteUserIdRef.current = payload.fromUserId;
            setCallState('incoming');
            setStatusText(`Incoming call from ${payload.fromUserName}`);
        });

        socket.on('video:outgoing-ringing', () => {
            setCallState('calling');
            setStatusText('Ringing...');
        });

        socket.on('video:call-unavailable', () => {
            toast.error('User is offline right now.');
            resetCallState(true);
        });

        socket.on('video:call-error', ({ message }) => {
            toast.error(message || 'Call error');
            resetCallState(true);
        });

        socket.on('video:call-accepted', async ({ fromUserId }) => {
            try {
                setRemoteUserId(fromUserId);
                remoteUserIdRef.current = fromUserId;
                setCallState('connecting');
                setStatusText('Connecting...');

                const stream = await ensureLocalMedia();
                const peer = createPeer();
                addLocalTracks(peer, stream);

                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);

                socket.emit('video:offer', {
                    toUserId: fromUserId,
                    sdp: offer,
                });
            } catch {
                toast.error('Failed to start call.');
                fullCleanup();
            }
        });

        socket.on('video:offer', async ({ fromUserId, sdp }) => {
            try {
                setRemoteUserId(fromUserId);
                remoteUserIdRef.current = fromUserId;
                setCallState('connecting');
                setStatusText('Connecting...');

                const stream = await ensureLocalMedia();
                const peer = createPeer();
                addLocalTracks(peer, stream);

                await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                await flushPendingIce();

                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);

                socket.emit('video:answer', {
                    toUserId: fromUserId,
                    sdp: answer,
                });
            } catch {
                toast.error('Failed to accept offer.');
                fullCleanup();
            }
        });

        socket.on('video:answer', async ({ sdp }) => {
            try {
                if (!peerRef.current) return;

                await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
                await flushPendingIce();

                setCallState('in-call');
                setStatusText('Connected');
            } catch {
                toast.error('Failed to process call answer.');
            }
        });

        socket.on('video:ice-candidate', async ({ candidate }) => {
            if (!candidate) return;

            try {
                if (peerRef.current?.remoteDescription) {
                    await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                } else {
                    pendingIceRef.current.push(candidate);
                }
            } catch {
                // Ignore stale ICE candidates.
            }
        });

        socket.on('video:call-rejected', ({ reason }) => {
            toast(reason || 'Call was declined.');
            fullCleanup();
        });

        socket.on('video:ended', () => {
            toast('Call ended');
            fullCleanup();
        });
    };

    useEffect(() => {
        const initUser = async () => {
            const doctorToken = localStorage.getItem('doctorAccessToken');
            const clientToken = localStorage.getItem('clientAccessToken');

            if (doctorToken) {
                const result = await checkDoctorAuth();
                if (result?.success && useDoctorAuthStore.getState().doctor?._id) {
                    const doctorUser = useDoctorAuthStore.getState().doctor;
                    setCurrentUser(doctorUser);
                    setUserType('Doctor');
                    setupSocket(doctorToken, doctorUser._id, 'Doctor');
                    return;
                }
            }

            if (clientToken) {
                const result = await checkClientAuth();
                if (result?.success && useClientAuthStore.getState().client?._id) {
                    const clientUser = useClientAuthStore.getState().client;
                    setCurrentUser(clientUser);
                    setUserType('Client');
                    setupSocket(clientToken, clientUser._id, 'Client');
                }
            }
        };

        initUser();

        return () => {
            fullCleanup();
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const fetchContacts = async () => {
            if (!userType) return;

            setLoadingContacts(true);
            try {
                if (userType === 'Doctor') {
                    const result = await getAllClients();
                    if (result?.success) {
                        setContacts(result.data || []);
                    }
                } else {
                    const result = await getAllDoctors();
                    if (result?.success) {
                        setContacts(result.data || []);
                    }
                }
            } finally {
                setLoadingContacts(false);
            }
        };

        fetchContacts();
    }, [userType, getAllClients, getAllDoctors]);

    const startCall = async () => {
        if (!selectedContact?._id) {
            toast.error('Please choose a contact first.');
            return;
        }

        if (!socketRef.current?.connected) {
            toast.error('Not connected to signaling server.');
            return;
        }

        try {
            setErrorText('');
            await ensureLocalMedia();
            setRemoteUserId(selectedContact._id);
            remoteUserIdRef.current = selectedContact._id;
            setCallState('calling');
            setStatusText('Calling...');

            socketRef.current.emit('video:call-request', {
                toUserId: selectedContact._id,
                callType: 'video',
            });
        } catch {
            // Error already handled in ensureLocalMedia.
        }
    };

    const acceptIncomingCall = async () => {
        if (!incomingCall?.fromUserId || !socketRef.current) return;

        try {
            setErrorText('');
            await ensureLocalMedia();

            setRemoteUserId(incomingCall.fromUserId);
            remoteUserIdRef.current = incomingCall.fromUserId;
            setCallState('connecting');
            setStatusText('Connecting...');

            socketRef.current.emit('video:call-accept', {
                toUserId: incomingCall.fromUserId,
            });

            setIncomingCall(null);
        } catch {
            // Error already handled in ensureLocalMedia.
        }
    };

    const rejectIncomingCall = () => {
        if (!incomingCall?.fromUserId || !socketRef.current) {
            resetCallState(true);
            return;
        }

        socketRef.current.emit('video:call-reject', {
            toUserId: incomingCall.fromUserId,
            reason: 'User declined the call',
        });

        resetCallState(true);
    };

    const endCurrentCall = () => {
        if (remoteUserId && socketRef.current) {
            socketRef.current.emit('video:end', {
                toUserId: remoteUserId,
                reason: 'Call ended',
            });
        }

        fullCleanup();
    };

    const toggleCamera = () => {
        if (!localStreamRef.current) return;

        const [videoTrack] = localStreamRef.current.getVideoTracks();
        if (!videoTrack) return;

        videoTrack.enabled = !videoTrack.enabled;
        setCameraEnabled(videoTrack.enabled);
    };

    const toggleMicrophone = () => {
        if (!localStreamRef.current) return;

        const [audioTrack] = localStreamRef.current.getAudioTracks();
        if (!audioTrack) return;

        audioTrack.enabled = !audioTrack.enabled;
        setMicEnabled(audioTrack.enabled);
    };

    if (!currentUser || !userType) {
        return (
            <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
                <div className="text-center">
                    <div className="h-12 w-12 mx-auto rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    <p className="mt-4 text-slate-300">Preparing secure video room...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6">
            <div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
                <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-4 md:p-5">
                    <div className="flex items-center justify-between">
                        <h1 className="text-lg font-semibold">Video Consult</h1>
                        <Link to="/" className="text-slate-300 hover:text-white">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                    </div>

                    <div className="mt-4 rounded-xl bg-slate-800/70 p-3">
                        <p className="text-sm text-slate-300">Signed in as</p>
                        <p className="font-medium mt-1">{currentUser.name || 'User'}</p>
                        <p className="text-xs text-cyan-300 mt-1">{userType}</p>
                    </div>

                    <div className="mt-4 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={`Search ${userType === 'Doctor' ? 'clients' : 'doctors'}`}
                            className="w-full bg-slate-800 text-white pl-9 pr-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div className="mt-4 text-xs uppercase tracking-wide text-slate-400">
                        {userType === 'Doctor' ? 'Clients' : 'Doctors'}
                    </div>

                    <div className="mt-2 space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                        {loadingContacts && (
                            <p className="text-sm text-slate-400">Loading contacts...</p>
                        )}

                        {!loadingContacts && displayContacts.length === 0 && (
                            <p className="text-sm text-slate-400">No contacts found.</p>
                        )}

                        {displayContacts.map((contact) => {
                            const active = selectedContact?._id === contact._id;
                            return (
                                <button
                                    key={contact._id}
                                    onClick={() => setSelectedContact(contact)}
                                    className={`w-full text-left rounded-xl p-3 border transition ${active
                                            ? 'bg-cyan-600/20 border-cyan-500'
                                            : 'bg-slate-800/70 border-slate-700 hover:border-slate-500'
                                        }`}
                                >
                                    <p className="font-medium">{contact.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-300 mt-1">{contact.email || 'No email'}</p>
                                    {contact.specialization && (
                                        <p className="text-xs text-cyan-300 mt-1">{contact.specialization}</p>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur p-4 md:p-5 min-h-[75vh]">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold">
                                {selectedContact ? selectedContact.name : 'Select a contact'}
                            </h2>
                            <p className="text-sm text-slate-300 mt-1">{statusText}</p>
                            {errorText && <p className="text-sm text-rose-300 mt-1">{errorText}</p>}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={toggleCamera}
                                disabled={!localStreamRef.current || (callState !== 'in-call' && callState !== 'connecting' && callState !== 'calling')}
                                className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 disabled:opacity-50"
                                title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                            >
                                {cameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                            </button>
                            <button
                                onClick={toggleMicrophone}
                                disabled={!localStreamRef.current || (callState !== 'in-call' && callState !== 'connecting' && callState !== 'calling')}
                                className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 disabled:opacity-50"
                                title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                            >
                                {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-black/40 border border-slate-800 overflow-hidden relative min-h-[280px]">
                            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                            <div className="absolute left-3 bottom-3 text-xs bg-black/50 px-2 py-1 rounded">You</div>
                        </div>
                        <div className="rounded-2xl bg-black/40 border border-slate-800 overflow-hidden relative min-h-[280px]">
                            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                            <div className="absolute left-3 bottom-3 text-xs bg-black/50 px-2 py-1 rounded">Remote</div>
                        </div>
                    </div>

                    {incomingCall && (
                        <div className="mt-5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 flex items-center justify-between gap-3">
                            <div>
                                <p className="font-medium">Incoming consultation</p>
                                <p className="text-sm text-slate-200 mt-1">{incomingCall.fromUserName} is calling you</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={acceptIncomingCall}
                                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500"
                                >
                                    Accept
                                </button>
                                <button
                                    onClick={rejectIncomingCall}
                                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500"
                                >
                                    Decline
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 flex flex-wrap gap-3">
                        <button
                            onClick={startCall}
                            disabled={!selectedContact || callState === 'calling' || callState === 'connecting' || callState === 'in-call'}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
                        >
                            <Phone className="w-4 h-4" />
                            Start Call
                        </button>

                        <button
                            onClick={endCurrentCall}
                            disabled={callState !== 'calling' && callState !== 'connecting' && callState !== 'in-call'}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
                        >
                            <PhoneOff className="w-4 h-4" />
                            End Call
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default VideoPage;
