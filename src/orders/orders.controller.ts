import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { OrdersService } from './orders.service';

type AuthUser = { id: string; role: UserRole };

@Controller('orders')
export class OrdersController {
	constructor(private readonly ordersService: OrdersService) {}

	/**
	 * Créer une commande (Guest ou Client connecté)
	 */
	@Post()
	@UseGuards(OptionalJwtAuthGuard)
	create(
		@Body() dto: CreateOrderDto,
		@CurrentUser() user: AuthUser | null,
	) {
		return this.ordersService.create(user?.id || null, dto);
	}

	/**
	 * Client : Obtenir ses propres commandes
	 */
	@Get('my-orders')
	@UseGuards(JwtAuthGuard)
	findMyOrders(
		@CurrentUser() user: AuthUser,
		@Query() query: OrderQueryDto,
	) {
		return this.ordersService.findMyOrders(user.id, query);
	}

	/**
	 * Client : Obtenir le détail d'une de ses commandes
	 */
	@Get('my-orders/:id')
	@UseGuards(JwtAuthGuard)
	findMyOrderById(
		@CurrentUser() user: AuthUser,
		@Param('id') id: string,
	) {
		return this.ordersService.findMyOrderById(user.id, id);
	}

	/**
	 * Client : Annuler une de ses commandes en attente
	 */
	@Patch('my-orders/:id/cancel')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard)
	cancelMyOrder(
		@CurrentUser() user: AuthUser,
		@Param('id') id: string,
	) {
		return this.ordersService.cancelMyOrder(user.id, id);
	}

	/**
	 * Admin / Staff : Lister toutes les commandes avec pagination & filtres
	 */
	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAll(@Query() query: OrderQueryDto) {
		return this.ordersService.findAll(query);
	}

	/**
	 * Admin / Staff : Obtenir les détails d'une commande
	 */
	@Get(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findOne(@Param('id') id: string) {
		return this.ordersService.findOne(id);
	}

	/**
	 * Admin / Staff : Mettre à jour le statut d'une commande (ex: CONFIRMED, SHIPPED, CANCELLED)
	 */
	@Patch(':id/status')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateStatus(
		@Param('id') id: string,
		@Body() dto: UpdateOrderStatusDto,
		@CurrentUser() user: AuthUser,
	) {
		return this.ordersService.updateStatus(id, dto, user.id);
	}

	/**
	 * Admin / Staff : Mettre à jour le statut de paiement
	 */
	@Patch(':id/payment-status')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updatePaymentStatus(
		@Param('id') id: string,
		@Body() dto: UpdatePaymentStatusDto,
	) {
		return this.ordersService.updatePaymentStatus(id, dto);
	}
}
