import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MarketingQueryDto } from './dto/marketing-query.dto';
import { MarketingService } from './marketing.service';

@Controller('marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.STAFF)
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get('overview')
  getOverview(@Query() query: MarketingQueryDto) {
    return this.marketingService.getOverview(query);
  }

  @Get('platforms')
  getPlatformComparison(@Query() query: MarketingQueryDto) {
    return this.marketingService.getPlatformComparison(query);
  }

  @Get('funnel')
  getFunnel(@Query() query: MarketingQueryDto) {
    return this.marketingService.getFunnel(query);
  }

  @Get('timeline')
  getTimeline(@Query() query: MarketingQueryDto) {
    return this.marketingService.getTimeline(query);
  }
}
