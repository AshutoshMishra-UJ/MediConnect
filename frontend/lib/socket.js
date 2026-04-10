// utils/socket.js
import { io } from 'socket.io-client';

const ENDPOINT = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(ENDPOINT, {
  withCredentials: true,
  transports: ['websocket'],
});

export default socket;
