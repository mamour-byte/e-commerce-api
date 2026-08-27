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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { ShippingService } from './shipping.service';

@Controller('shipping')
export class ShippingController {
	constructor(private readonly shippingService: ShippingService) {}

	/**
	 * Public : zones de livraison actives pour le checkout
	 */
	@Get('zones')
	findActiveZones() {
		return this.shippingService.findAllZones(false);
	}

	/**
	 * Admin / Staff : créer une zone de livraison
	 */
	@Post('zones')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	createZone(@Body() dto: CreateDeliveryZoneDto) {
		return this.shippingService.createZone(dto);
	}

	/**
	 * Admin / Staff : lister toutes les zones (actives et inactives)
	 */
	@Get('zones/admin')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAllZonesAdmin() {
		return this.shippingService.findAllZones(true);
	}

	/**
	 * Admin / Staff : détail d'une zone
	 */
	@Get('zones/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findZoneOne(@Param('id') id: string) {
		return this.shippingService.findZoneOne(id);
	}

	/**
	 * Admin / Staff : modifier une zone
	 */
	@Patch('zones/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateZone(
		@Param('id') id: string,
		@Body() dto: UpdateDeliveryZoneDto,
	) {
		return this.shippingService.updateZone(id, dto);
	}

	/**
	 * Admin : supprimer une zone
	 */
	@Delete('zones/:id')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN)
	removeZone(@Param('id') id: string) {
		return this.shippingService.removeZone(id);
	}
}
