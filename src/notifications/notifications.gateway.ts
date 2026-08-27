import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedUsers = new Map<string, string>(); // userId -> socketId

  constructor(private readonly notificationsService: NotificationsService) {}

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.connectedUsers.set(userId, client.id);
      this.logger.log(`User ${userId} connected with socket ${client.id}`);
      
      // Join user-specific room
      client.join(`user:${userId}`);
      
      // Join admin/staff room for admin notifications
      client.join('admin');
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.findUserIdBySocketId(client.id);
    if (userId) {
      this.connectedUsers.delete(userId);
      this.logger.log(`User ${userId} disconnected`);
    }
  }

  private findUserIdBySocketId(socketId: string): string | undefined {
    for (const [userId, id] of this.connectedUsers.entries()) {
      if (id === socketId) return userId;
    }
    return undefined;
  }

  // Send notification to specific user
  sendToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  // Send notification to all admins/staff
  sendToAdmins(notification: any) {
    this.server.to('admin').emit('notification', notification);
  }

  // Send notification to all connected clients
  sendToAll(notification: any) {
    this.server.emit('notification', notification);
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.findUserIdBySocketId(client.id);
    if (userId) {
      await this.notificationsService.markAsRead(data.notificationId, userId);
      return { success: true };
    }
    return { success: false, error: 'User not found' };
  }

  @SubscribeMessage('markAllAsRead')
  async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
    const userId = this.findUserIdBySocketId(client.id);
    if (userId) {
      await this.notificationsService.markAllAsRead(userId);
      return { success: true };
    }
    return { success: false, error: 'User not found' };
  }
}
