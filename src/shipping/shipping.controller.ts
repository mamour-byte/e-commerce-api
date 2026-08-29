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
	Query,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateDeliveryNeighborhoodDto } from './dto/create-delivery-neighborhood.dto';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryNeighborhoodDto } from './dto/update-delivery-neighborhood.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { ShippingService } from './shipping.service';

@Controller('shipping')
export class ShippingController {
	constructor(private readonly shippingService: ShippingService) {}

	// ─────────────────────────────────────────────────────────────────────────
	// ZONES DE LIVRAISON
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Public : zones de livraison actives avec leurs quartiers pour le checkout
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

	// ─────────────────────────────────────────────────────────────────────────
	// QUARTIERS DE LIVRAISON (NEIGHBORHOODS)
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Public : lister tous les quartiers actifs avec les infos de leur zone
	 * Très utile pour le checkout (recherche / select de quartier)
	 */
	@Get('neighborhoods')
	findActiveNeighborhoods(@Query('zoneId') zoneId?: string) {
		return this.shippingService.findAllNeighborhoods(false, zoneId);
	}

	/**
	 * Admin / Staff : lister tous les quartiers (actifs et inactifs)
	 */
	@Get('neighborhoods/admin')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAllNeighborhoodsAdmin(@Query('zoneId') zoneId?: string) {
		return this.shippingService.findAllNeighborhoods(true, zoneId);
	}

	/**
	 * Public : détail d'un quartier actif
	 */
	@Get('neighborhoods/:id')
	findNeighborhoodOne(@Param('id') id: string) {
		return this.shippingService.findActiveNeighborhood(id);
	}

	/**
	 * Admin / Staff : créer un ou plusieurs quartiers rattachés à une zone
	 */
	@Post('neighborhoods')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	createNeighborhood(@Body() dto: CreateDeliveryNeighborhoodDto) {
		return this.shippingService.createNeighborhood(dto);
	}

	/**
	 * Admin / Staff : modifier un quartier
	 */
	@Patch('neighborhoods/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateNeighborhood(
		@Param('id') id: string,
		@Body() dto: UpdateDeliveryNeighborhoodDto,
	) {
		return this.shippingService.updateNeighborhood(id, dto);
	}

	/**
	 * Admin : supprimer un quartier
	 */
	@Delete('neighborhoods/:id')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN)
	removeNeighborhood(@Param('id') id: string) {
		return this.shippingService.removeNeighborhood(id);
	}
}
