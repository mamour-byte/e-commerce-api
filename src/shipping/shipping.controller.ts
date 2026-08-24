import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';
import { ShippingService } from './shipping.service';

type AuthUser = { id: string };

@Controller('shipping')
export class ShippingController {
	constructor(private readonly shippingService: ShippingService) {}

	/**
	 * Public : Lister les méthodes de livraison actives pour le checkout
	 */
	@Get('methods')
	findActiveMethods() {
		return this.shippingService.findAllMethods(false);
	}

	/**
	 * Public : Suivre un colis via son numéro de suivi
	 */
	@Get('track/:trackingNumber')
	trackShipment(@Param('trackingNumber') trackingNumber: string) {
		return this.shippingService.findShipmentByTrackingNumber(trackingNumber);
	}

	/**
	 * Client / Public : Obtenir le suivi d'expédition lié à une commande
	 */
	@Get('order/:orderId')
	@UseGuards(OptionalJwtAuthGuard)
	findShipmentByOrder(
		@Param('orderId') orderId: string,
		@CurrentUser() user: AuthUser | null,
	) {
		return this.shippingService.findShipmentByOrder(orderId, user?.id);
	}

	/**
	 * Admin / Staff : Créer une nouvelle méthode de livraison
	 */
	@Post('methods')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	createMethod(@Body() dto: CreateShippingMethodDto) {
		return this.shippingService.createMethod(dto);
	}

	/**
	 * Admin / Staff : Lister toutes les méthodes de livraison (actives et inactives)
	 */
	@Get('methods/admin')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAllMethodsAdmin() {
		return this.shippingService.findAllMethods(true);
	}

	/**
	 * Admin / Staff : Détails d'une méthode de livraison
	 */
	@Get('methods/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findMethodOne(@Param('id') id: string) {
		return this.shippingService.findMethodOne(id);
	}

	/**
	 * Admin / Staff : Modifier une méthode de livraison
	 */
	@Patch('methods/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateMethod(
		@Param('id') id: string,
		@Body() dto: UpdateShippingMethodDto,
	) {
		return this.shippingService.updateMethod(id, dto);
	}

	/**
	 * Admin : Supprimer une méthode de livraison
	 */
	@Delete('methods/:id')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN)
	removeMethod(@Param('id') id: string) {
		return this.shippingService.removeMethod(id);
	}

	/**
	 * Admin / Staff : Mettre à jour le statut d'une expédition et son numéro de suivi
	 */
	@Patch('shipments/:id/status')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateShipmentStatus(
		@Param('id') id: string,
		@Body() dto: UpdateShipmentStatusDto,
	) {
		return this.shippingService.updateShipmentStatus(id, dto);
	}
}
