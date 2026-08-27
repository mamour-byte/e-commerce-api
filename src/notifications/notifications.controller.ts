import {
  Controller,
  Get,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsService } from './notifications.service';

type AuthUser = { id: string; role: UserRole };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Obtenir les notifications de l'utilisateur connecté
   */
  @Get()
  findMyNotifications(
    @CurrentUser() user: AuthUser,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.findAll(
      user.id,
      unreadOnly === 'true',
    );
  }

  /**
   * Obtenir le nombre de notifications non lues
   */
  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  /**
   * Marquer une notification comme lue
   */
  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  @Patch('mark-all-read')
  markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  /**
   * Supprimer une notification
   */
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notificationsService.delete(id, user.id);
  }
}
