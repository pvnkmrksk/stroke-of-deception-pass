
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import mockSocketServer from '@/lib/socket-mock';

// Mock socket implementation for local development
const createMockSocket = () => {
  const listeners = new Map();
  const emitters = new Map();
  let id = `user-${Math.random().toString(36).substring(2, 9)}`;
  
  const mockSocket = {
    id,
    connected: true,
    
    on: (event: string, callback: any) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(callback);
      return mockSocket;
    },
    
    off: (event: string, callback?: any) => {
      if (!listeners.has(event)) return mockSocket;
      if (callback) {
        const callbacks = listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      } else {
        listeners.delete(event);
      }
      return mockSocket;
    },
    
    emit: (event: string, ...args: any[]) => {
      console.log(`[MockSocket] Emitting ${event}`, args);
      
      // Special handling for certain events
      if (event === 'create-room') {
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
          // Register the callback with the server and generate a room
          mockSocketServer.registerCallback(id, 'create-room', callback);
          const roomId = mockSocketServer.createRoom(id);
          // Execute the callback with a slight delay to simulate network
          setTimeout(() => {
            mockSocketServer.executeCallback(id, 'create-room', roomId);
          }, 300);
        }
      } 
      else if (event === 'join-room') {
        const roomId = args[0];
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
          mockSocketServer.registerCallback(id, 'join-room', callback);
          console.log(`[MockSocket] Attempting to join room ${roomId} with client ${id}`);
          
          // Clear any old room data first to prevent stale connections
          mockSocketServer.leaveRoom(id);
          
          // Ensure the server loads the latest rooms from localStorage
          mockSocketServer.loadPersistentRooms();
          
          const success = mockSocketServer.joinRoom(id, roomId);
          setTimeout(() => {
            console.log(`[MockSocket] Join room result for ${roomId}: ${success ? "success" : "failed"}`);
            mockSocketServer.executeCallback(id, 'join-room', success);
          }, 300);
        }
      }
      else if (event === 'leave-room') {
        const roomId = args[0];
        mockSocketServer.leaveRoom(id);
      }
      else if (event.includes('drawing-action')) {
        // Forward drawing actions to all clients in the room
        const data = args[0];
        if (data && data.roomId) {
          mockSocketServer.broadcastToRoom(data.roomId, 'drawing-update', data);
        }
      }
      
      // Save emitter for later use
      if (!emitters.has(event)) {
        emitters.set(event, []);
      }
      emitters.get(event).push(args);
      
      return mockSocket;
    },
    
    // For testing/debugging
    disconnect: () => {
      console.log(`[MockSocket] Disconnecting`);
      const disconnectCallbacks = listeners.get('disconnect') || [];
      disconnectCallbacks.forEach((callback: any) => callback());
      return mockSocket;
    },
    
    // Simulate receiving an event
    receive: (event: string, ...args: any[]) => {
      console.log(`[MockSocket] Receiving ${event}`, args);
      const callbacks = listeners.get(event) || [];
      callbacks.forEach((callback: any) => callback(...args));
      return mockSocket;
    },
    
    // Get socket id
    getId: () => id
  };
  
  // Simulate connect event (already connected in mock)
  setTimeout(() => {
    const connectCallbacks = listeners.get('connect') || [];
    connectCallbacks.forEach((callback: any) => callback());
  }, 100);
  
  // Listen for broadcast events from the room
  mockSocketServer.on('player-joined', (data) => {
    if (data && data.roomId && mockSocketServer.getClientsInRoom(data.roomId).includes(id)) {
      mockSocket.receive('player-joined', data);
    }
  });
  
  mockSocketServer.on('player-left', (data) => {
    if (data && data.roomId && mockSocketServer.getClientsInRoom(data.roomId).includes(id)) {
      mockSocket.receive('player-left', data);
    }
  });
  
  // Listen for drawing updates
  mockSocketServer.on('room:*:drawing-update', (data) => {
    const roomId = mockSocketServer.getRoomForClient(id);
    if (roomId && data && data.roomId === roomId) {
      mockSocket.receive('drawing-update', data);
    }
  });
  
  return mockSocket;
};

interface SocketContextType {
  socket: any; // Changed from Socket | null to any to accommodate mock socket
  isConnected: boolean;
  roomId: string | null;
  createRoom: () => Promise<string>;
  joinRoom: (roomId: string) => Promise<boolean>;
  leaveRoom: () => void;
  isConnecting: boolean;
  debugResetRooms: () => void; // Added for debugging purposes
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  roomId: null,
  createRoom: async () => '',
  joinRoom: async () => false,
  leaveRoom: () => {},
  isConnecting: false,
  debugResetRooms: () => {}
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();
  
  // Initialize socket connection
  useEffect(() => {
    console.log("[SocketContext] Initializing socket");
    
    // Create mock socket for local development
    const socketInstance = createMockSocket();
    
    socketInstance.on('connect', () => {
      console.log('[SocketContext] Socket connected with ID:', socketInstance.getId());
      setIsConnected(true);
      setIsConnecting(false);
      toast({
        title: "Connected to server",
        description: "Ready for multiplayer gameplay",
      });
    });

    socketInstance.on('disconnect', () => {
      console.log('[SocketContext] Socket disconnected');
      setIsConnected(false);
      setRoomId(null);
      toast({
        title: "Disconnected",
        description: "Lost connection to game server",
        variant: "destructive"
      });
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      console.log('[SocketContext] Cleaning up socket');
      socketInstance.disconnect();
    };
  }, [toast]);
  
  // Room creation function
  const createRoom = async (): Promise<string> => {
    if (!socket) throw new Error('Socket not connected');
    setIsConnecting(true);
    
    return new Promise((resolve, reject) => {
      // Add timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        setIsConnecting(false);
        reject(new Error('Room creation timeout'));
        toast({
          title: "Room creation failed",
          description: "Server took too long to respond",
          variant: "destructive"
        });
      }, 5000);
      
      try {
        socket.emit('create-room', (newRoomId: string) => {
          clearTimeout(timeout);
          setIsConnecting(false);
          console.log('[SocketContext] Room created:', newRoomId);
          setRoomId(newRoomId);
          toast({
            title: "Room created",
            description: `Successfully created room ${newRoomId}`,
          });
          resolve(newRoomId);
        });
      } catch (error) {
        clearTimeout(timeout);
        setIsConnecting(false);
        console.error('[SocketContext] Error creating room:', error);
        reject(error);
        toast({
          title: "Room creation failed",
          description: "An unexpected error occurred",
          variant: "destructive"
        });
      }
    });
  };

  // Room joining function
  const joinRoom = async (roomToJoin: string): Promise<boolean> => {
    if (!socket) throw new Error('Socket not connected');
    setIsConnecting(true);
    
    // Clear any existing room first
    if (roomId) {
      leaveRoom();
    }
    
    // Validate room format before trying to join
    if (!roomToJoin || roomToJoin.length !== 6) {
      setIsConnecting(false);
      toast({
        title: "Invalid room code",
        description: "Please enter a valid 6-character room code",
        variant: "destructive"
      });
      return Promise.resolve(false);
    }
    
    console.log(`[SocketContext] Checking if room ${roomToJoin} exists...`);
    
    // Force reload room data from localStorage
    mockSocketServer.loadPersistentRooms();
    
    // Pre-check if room exists to provide better feedback
    const roomExists = mockSocketServer.roomExists(roomToJoin);
    console.log(`[SocketContext] Room ${roomToJoin} exists: ${roomExists}`);
    
    if (!roomExists) {
      setIsConnecting(false);
      toast({
        title: "Room not found",
        description: "The room you're trying to join doesn't exist",
        variant: "destructive"
      });
      return Promise.resolve(false);
    }
    
    return new Promise((resolve, reject) => {
      // Add timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        setIsConnecting(false);
        reject(new Error('Join room timeout'));
        toast({
          title: "Joining room failed",
          description: "Server took too long to respond",
          variant: "destructive"
        });
      }, 5000);
      
      try {
        socket.emit('join-room', roomToJoin, (success: boolean) => {
          clearTimeout(timeout);
          setIsConnecting(false);
          
          if (success) {
            console.log('[SocketContext] Joined room:', roomToJoin);
            setRoomId(roomToJoin);
            toast({
              title: "Joined room",
              description: `Successfully joined room ${roomToJoin}`,
            });
          } else {
            console.log('[SocketContext] Failed to join room:', roomToJoin);
            toast({
              title: "Joining room failed",
              description: "Room might be full or has expired",
              variant: "destructive"
            });
          }
          
          resolve(success);
        });
      } catch (error) {
        clearTimeout(timeout);
        setIsConnecting(false);
        console.error('[SocketContext] Error joining room:', error);
        reject(error);
        toast({
          title: "Joining room failed",
          description: "An unexpected error occurred",
          variant: "destructive"
        });
      }
    });
  };

  // Leave room function
  const leaveRoom = () => {
    if (socket && roomId) {
      socket.emit('leave-room', roomId);
      setRoomId(null);
      toast({
        title: "Left room",
        description: "You have left the multiplayer game",
      });
    }
  };
  
  // Debug function to reset all rooms (for testing)
  const debugResetRooms = () => {
    mockSocketServer.clearAllRooms();
    setRoomId(null);
    toast({
      title: "Debug: Rooms Reset",
      description: "All multiplayer rooms have been cleared",
    });
  };
  
  const value = {
    socket,
    isConnected,
    roomId,
    createRoom,
    joinRoom,
    leaveRoom,
    isConnecting,
    debugResetRooms
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
