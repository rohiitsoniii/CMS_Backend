/**
 * Real-Time Collaboration Service using Socket.IO
 * 
 * Features:
 * - Live presence (who's online)
 * - Real-time cursor positions
 * - Live content updates
 * - Collaborative editing
 * - Notifications
 */

import { Server as HTTPServer } from 'http';
import { config } from '../config/index.js';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

interface User {
  id: string;
  name: string;
  email: string;
  color: string;
}

interface Presence {
  userId: string;
  user: User;
  contentId?: string;
  cursorPosition?: number;
  lastActivity: Date;
}

interface ContentUpdate {
  contentId: string;
  userId: string;
  changes: any;
  timestamp: Date;
}

class CollaborationService {
  private io: Server | null = null;
  private presence: Map<string, Presence> = new Map();
  private activeEditors: Map<string, Set<string>> = new Map(); // contentId -> Set of userIds

  /**
   * Initialize Socket.IO server
   */
  initialize(httpServer: HTTPServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true,
      },
      path: '/socket.io',
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication error'));
        }

        const decoded = jwt.verify(token, config.jwt.secret) as any;
        socket.data.user = decoded;
        next();
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('✅ Real-time collaboration service initialized');
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket) {
    const user: User = {
      id: socket.data.user.userId,
      name: socket.data.user.name,
      email: socket.data.user.email,
      color: this.generateUserColor(),
    };

    console.log(`👤 User connected: ${user.name} (${socket.id})`);

    // Add to presence
    this.presence.set(socket.id, {
      userId: user.id,
      user,
      lastActivity: new Date(),
    });

    // Send current presence to new user
    socket.emit('presence:init', this.getPresenceList());

    // Broadcast new user to others
    socket.broadcast.emit('presence:join', {
      socketId: socket.id,
      user,
    });

    // Join content room
    socket.on('content:join', (contentId: string) => {
      this.handleContentJoin(socket, contentId, user);
    });

    // Leave content room
    socket.on('content:leave', (contentId: string) => {
      this.handleContentLeave(socket, contentId, user);
    });

    // Content update
    socket.on('content:update', (data: ContentUpdate) => {
      this.handleContentUpdate(socket, data);
    });

    // Cursor position
    socket.on('cursor:move', (data: { contentId: string; position: number }) => {
      this.handleCursorMove(socket, data, user);
    });

    // Typing indicator
    socket.on('typing:start', (contentId: string) => {
      socket.to(`content:${contentId}`).emit('typing:user', {
        userId: user.id,
        user,
        typing: true,
      });
    });

    socket.on('typing:stop', (contentId: string) => {
      socket.to(`content:${contentId}`).emit('typing:user', {
        userId: user.id,
        user,
        typing: false,
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      this.handleDisconnect(socket, user);
    });
  }

  /**
   * Handle user joining content editing
   */
  private handleContentJoin(socket: Socket, contentId: string, user: User) {
    const roomName = `content:${contentId}`;
    socket.join(roomName);

    // Track active editors
    if (!this.activeEditors.has(contentId)) {
      this.activeEditors.set(contentId, new Set());
    }
    this.activeEditors.get(contentId)!.add(user.id);

    // Update presence
    const presence = this.presence.get(socket.id);
    if (presence) {
      presence.contentId = contentId;
    }

    // Get other editors
    const editors = this.getContentEditors(contentId);

    // Notify user of other editors
    socket.emit('content:editors', editors);

    // Notify others of new editor
    socket.to(roomName).emit('content:editor-join', {
      userId: user.id,
      user,
    });

    console.log(`📝 ${user.name} joined editing: ${contentId}`);
  }

  /**
   * Handle user leaving content editing
   */
  private handleContentLeave(socket: Socket, contentId: string, user: User) {
    const roomName = `content:${contentId}`;
    socket.leave(roomName);

    // Remove from active editors
    this.activeEditors.get(contentId)?.delete(user.id);

    // Update presence
    const presence = this.presence.get(socket.id);
    if (presence) {
      presence.contentId = undefined;
      presence.cursorPosition = undefined;
    }

    // Notify others
    socket.to(roomName).emit('content:editor-leave', {
      userId: user.id,
    });

    console.log(`📝 ${user.name} left editing: ${contentId}`);
  }

  /**
   * Handle content update
   */
  private handleContentUpdate(socket: Socket, data: ContentUpdate) {
    const roomName = `content:${data.contentId}`;

    // Broadcast to others in the room
    socket.to(roomName).emit('content:change', {
      userId: data.userId,
      changes: data.changes,
      timestamp: data.timestamp,
    });
  }

  /**
   * Handle cursor movement
   */
  private handleCursorMove(
    socket: Socket,
    data: { contentId: string; position: number },
    user: User
  ) {
    const roomName = `content:${data.contentId}`;

    // Update presence
    const presence = this.presence.get(socket.id);
    if (presence) {
      presence.cursorPosition = data.position;
      presence.lastActivity = new Date();
    }

    // Broadcast to others
    socket.to(roomName).emit('cursor:update', {
      userId: user.id,
      user,
      position: data.position,
    });
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket, user: User) {
    // Remove from presence
    this.presence.delete(socket.id);

    // Remove from all active editors
    this.activeEditors.forEach((editors, contentId) => {
      if (editors.has(user.id)) {
        editors.delete(user.id);
        // Notify others in that content
        socket.to(`content:${contentId}`).emit('content:editor-leave', {
          userId: user.id,
        });
      }
    });

    // Broadcast to all
    socket.broadcast.emit('presence:leave', {
      socketId: socket.id,
      userId: user.id,
    });

    console.log(`👤 User disconnected: ${user.name} (${socket.id})`);
  }

  /**
   * Get presence list
   */
  private getPresenceList(): Array<{ socketId: string; user: User; contentId?: string }> {
    return Array.from(this.presence.entries()).map(([socketId, presence]) => ({
      socketId,
      user: presence.user,
      contentId: presence.contentId,
    }));
  }

  /**
   * Get editors for a content item
   */
  private getContentEditors(contentId: string): User[] {
    const editors: User[] = [];
    const editorIds = this.activeEditors.get(contentId);

    if (editorIds) {
      this.presence.forEach((presence) => {
        if (editorIds.has(presence.userId)) {
          editors.push(presence.user);
        }
      });
    }

    return editors;
  }

  /**
   * Generate random color for user
   */
  private generateUserColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8B739', '#52B788', '#E76F51', '#2A9D8F',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Broadcast notification to all users
   */
  broadcastNotification(notification: {
    type: string;
    title: string;
    message: string;
    data?: any;
  }) {
    if (this.io) {
      this.io.emit('notification', notification);
    }
  }

  /**
   * Send notification to specific user
   */
  sendNotificationToUser(userId: string, notification: any) {
    if (this.io) {
      // Find socket for user
      this.presence.forEach((presence, socketId) => {
        if (presence.userId === userId) {
          this.io!.to(socketId).emit('notification', notification);
        }
      });
    }
  }

  /**
   * Helper to notify a specific user with a specific event
   */
  notifyUser(userId: string, event: string, payload: any) {
    if (this.io) {
      this.presence.forEach((presence, socketId) => {
        if (presence.userId === userId) {
          this.io!.to(socketId).emit(event, payload);
        }
      });
    }
  }

  /**
   * Broadcast content published event
   */
  broadcastContentPublished(contentId: string, content: any) {
    if (this.io) {
      this.io.emit('content:published', {
        contentId,
        content,
      });
    }
  }

  /**
   * Get server instance
   */
  getIO(): Server | null {
    return this.io;
  }
}

export default new CollaborationService();
