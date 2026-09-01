import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private gateway: any;

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async create(data: {
    userId?: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: any;
    orderId?: string;
    sendToAdmin?: boolean;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        data: data.data as Prisma.InputJsonValue,
        orderId: data.orderId,
      },
    });

    // Send real-time notification via WebSocket
    if (data.userId) {
      this.gateway.sendToUser(data.userId, notification);
    }

    if (data.sendToAdmin) {
      this.gateway.sendToAdmins(notification);
    }

    return notification;
  }

  async findAll(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly && { isRead: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findOne(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification introuvable.');
    }

    return notification;
  }

  async markAsRead(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async delete(id: string, userId: string) {
    await this.findOne(id, userId);

    await this.prisma.notification.delete({
      where: { id },
    });

    return { message: 'Notification supprimée avec succès.' };
  }

  // Helper methods for common notification types
  async notifyOrderCreated(orderId: string, orderNumber: string, sendToAdmin = true) {
    return this.create({
      type: NotificationType.ORDER_CREATED,
      title: 'Nouvelle commande',
      message: `Commande #${orderNumber} reçue`,
      data: { orderNumber },
      orderId,
      sendToAdmin,
    });
  }

  async notifyOrderConfirmed(orderId: string, orderNumber: string, userId?: string) {
    return this.create({
      userId,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Commande confirmée',
      message: `Votre commande #${orderNumber} a été confirmée`,
      data: { orderNumber },
      orderId,
    });
  }

  async notifyOrderInDelivery(orderId: string, orderNumber: string, userId?: string) {
    return this.create({
      userId,
      type: NotificationType.ORDER_IN_DELIVERY,
      title: 'Commande en livraison',
      message: `Votre commande #${orderNumber} est en cours de livraison`,
      data: { orderNumber },
      orderId,
    });
  }

  async notifyOrderDelivered(orderId: string, orderNumber: string, userId?: string) {
    return this.create({
      userId,
      type: NotificationType.ORDER_DELIVERED,
      title: 'Commande livrée',
      message: `Votre commande #${orderNumber} a été livrée`,
      data: { orderNumber },
      orderId,
    });
  }

  async notifyOrderCancelled(orderId: string, orderNumber: string, userId?: string) {
    return this.create({
      userId,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Commande annulée',
      message: `Votre commande #${orderNumber} a été annulée`,
      data: { orderNumber },
      orderId,
    });
  }

  async notifyPaymentReceived(orderId: string, orderNumber: string, userId?: string) {
    return this.create({
      userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Paiement reçu',
      message: `Paiement reçu pour la commande #${orderNumber}`,
      data: { orderNumber },
      orderId,
    });
  }

  async notifyLowStock(productId: string, productName: string, stock: number) {
    return this.create({
      type: NotificationType.LOW_STOCK,
      title: 'Stock faible',
      message: `Le produit ${productName} a un stock faible (${stock} unités)`,
      data: { productId, productName, stock },
      sendToAdmin: true,
    });
  }

  async notifyOutOfStock(productId: string, productName: string) {
    return this.create({
      type: NotificationType.OUT_OF_STOCK,
      title: 'Stock épuisé',
      message: `Le produit ${productName} est en rupture de stock`,
      data: { productId, productName },
      sendToAdmin: true,
    });
  }
}
