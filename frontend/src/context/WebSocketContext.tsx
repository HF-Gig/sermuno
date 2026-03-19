import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, SOCKET_UPDATED_EVENT } from '../lib/socket';

type WebSocketContextValue = {
    socket: Socket | null;
    isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(getSocket());
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const syncSocket = () => setSocket(getSocket());
        window.addEventListener(SOCKET_UPDATED_EVENT, syncSocket);
        return () => window.removeEventListener(SOCKET_UPDATED_EVENT, syncSocket);
    }, []);

    useEffect(() => {
        const activeSocket = getSocket();
        setSocket(activeSocket);

        if (!activeSocket) {
            setIsConnected(false);
            return;
        }

        activeSocket.on('connect', () => {
            console.log('[WS] Connected:', activeSocket.id);
            setIsConnected(true);
        });

        activeSocket.on('disconnect', (reason) => {
            console.log('[WS] Disconnected:', reason);
            setIsConnected(false);
        });

        activeSocket.on('connect_error', (err) => {
            // Socket.io may first attempt websocket then downgrade/upgrade transports.
            // Treat this as debug noise unless connection never succeeds.
            console.debug('[WS] Connection warning:', err.message);
        });

        return () => {
            activeSocket.off('connect');
            activeSocket.off('disconnect');
            activeSocket.off('connect_error');
            setIsConnected(false);
        };
    }, [socket]);

    const value = useMemo(
        () => ({ socket, isConnected }),
        [socket, isConnected]
    );

    return (
        <WebSocketContext.Provider value={value}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
};
