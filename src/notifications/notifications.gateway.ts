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
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';

type JwtPayload = { sub: string; role: string };

function getWebsocketOrigins(): string[] {
  return (
    process.env.FRONTEND_URLS ??
    'http://localhost:5173,https://hayatstore-five.vercel.app'
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

@WebSocketGateway({
  cors: {
    origin: getWebsocketOrigins(),
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);

    if (!token) {
      this.logger.warn(
        `WebSocket connexion refusée : token manquant (${client.id})`,
      );
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const userId = payload.sub;
      if (!userId) throw new UnauthorizedException();

      client.data.userId = userId;
      client.data.role = payload.role || 'CUSTOMER';

      // Rejoindre UNIQUEMENT sa propre room
      client.join(`user:${userId}`);

      // Seuls les admins/staff rejoignent la room des notifications admin
      if (client.data.role === 'ADMIN' || client.data.role === 'STAFF') {
        client.join('admin');
      }

      this.connectedUsers.set(userId, client.id);
      this.logger.log(`User ${userId} connected with socket ${client.id}`);
    } catch {
      this.logger.warn(
        `WebSocket connexion refusée : token invalide (${client.id})`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId =
      (client.data.userId as string | undefined) ||
      this.findUserIdBySocketId(client.id);
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

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !data?.notificationId) {
      return { success: false, error: 'Unauthorized' };
    }
    await this.notificationsService.markAsRead(data.notificationId, userId);
    return { success: true };
  }

  @SubscribeMessage('markAllAsRead')
  async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }
    await this.notificationsService.markAllAsRead(userId);
    return { success: true };
  }
}
