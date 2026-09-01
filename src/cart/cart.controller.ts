import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type AuthUser = { id: string };

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /**
   * Récupérer le panier — guest (via X-Session-Id) ou connecté
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  get(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.cartService.get({ userId: user?.id, sessionId });
  }

  /**
   * Ajouter un article
   */
  @Post('items')
  @UseGuards(OptionalJwtAuthGuard)
  addItem(
    @Body() dto: AddCartItemDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.cartService.addItem({ userId: user?.id, sessionId }, dto);
  }

  /**
   * Mettre à jour la quantité d'un article
   */
  @Patch('items/:itemId')
  @UseGuards(OptionalJwtAuthGuard)
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.cartService.updateItem(
      { userId: user?.id, sessionId },
      itemId,
      dto,
    );
  }

  /**
   * Supprimer un article
   */
  @Delete('items/:itemId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  removeItem(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.cartService.removeItem({ userId: user?.id, sessionId }, itemId);
  }

  /**
   * Vider le panier
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  clear(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return this.cartService.clear({ userId: user?.id, sessionId });
  }

  /**
   * Fusionner le panier guest dans le panier utilisateur (après login)
   */
  @Post('merge')
  @UseGuards(JwtAuthGuard)
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeCartDto) {
    return this.cartService.merge(user.id, dto.sessionId);
  }
}
