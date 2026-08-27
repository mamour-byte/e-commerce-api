import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.STAFF)
export class StatsController {
	constructor(private readonly statsService: StatsService) {}

	@Get('dashboard')
	getDashboard(@Query() query: StatsQueryDto) {
		return this.statsService.getDashboard(query);
	}

	@Get('sales')
	getSales(@Query() query: StatsQueryDto) {
		return this.statsService.getSales(query);
	}

	@Get('products')
	getProducts(@Query() query: StatsQueryDto) {
		return this.statsService.getProducts(query);
	}
}
