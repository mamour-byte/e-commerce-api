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
import { CouponQueryDto } from './dto/coupon-query.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponsService } from './coupons.service';

@Controller('coupons')
export class CouponsController {
	constructor(private readonly couponsService: CouponsService) {}

	/**
	 * Client : Tester et calculer la réduction d'un code promo sur son panier
	 */
	@Post('validate')
	@HttpCode(HttpStatus.OK)
	validate(@Body() dto: ValidateCouponDto) {
		return this.couponsService.validate(dto);
	}

	/**
	 * Admin / Staff : Créer un nouveau coupon de réduction
	 */
	@Post()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	create(@Body() dto: CreateCouponDto) {
		return this.couponsService.create(dto);
	}

	/**
	 * Admin / Staff : Lister les coupons avec recherche et filtres
	 */
	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAll(@Query() query: CouponQueryDto) {
		return this.couponsService.findAll(query);
	}

	/**
	 * Admin / Staff : Obtenir les détails d'un coupon
	 */
	@Get(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findOne(@Param('id') id: string) {
		return this.couponsService.findOne(id);
	}

	/**
	 * Admin / Staff : Historique d'utilisation d'un coupon
	 */
	@Get(':id/usages')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	getUsages(
		@Param('id') id: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		return this.couponsService.getUsages(id, page, limit);
	}

	/**
	 * Admin / Staff : Modifier un coupon
	 */
	@Patch(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	update(
		@Param('id') id: string,
		@Body() dto: UpdateCouponDto,
	) {
		return this.couponsService.update(id, dto);
	}

	/**
	 * Admin : Supprimer un coupon
	 */
	@Delete(':id')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN)
	remove(@Param('id') id: string) {
		return this.couponsService.remove(id);
	}
}
