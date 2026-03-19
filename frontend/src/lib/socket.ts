import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let socketToken: string | null = null;
const SOCKET_UPDATED_EVENT = 'sermuno:socket-updated';

export function connectSocket(token: string) {
    const serverUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    if (socket && socketToken === token) {
        if (socket.disconnected) {
            socket.connect();
        }
        return socket;
    }

    if (socket) {
        socket.disconnect();
    }

    socketToken = token;

    socket = io(serverUrl, {
        auth: { token },
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 800,
    });

    window.dispatchEvent(new CustomEvent(SOCKET_UPDATED_EVENT));

    return socket;
}

export function getSocket() {
    return socket;
}

export function disconnectSocket() {
    socket?.disconnect();
    socket = null;
    socketToken = null;
    window.dispatchEvent(new CustomEvent(SOCKET_UPDATED_EVENT));
}

export { SOCKET_UPDATED_EVENT };
