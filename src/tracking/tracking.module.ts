import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { MetaCapiService } from './services/meta-capi.service';
import { GoogleAdsService } from './google-ads.service';
import { TrackingJobsService } from './tracking.jobs';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    MetaCapiService,
    GoogleAdsService,
    TrackingJobsService,
  ],
  exports: [TrackingService, MetaCapiService, GoogleAdsService],
})
export class TrackingModule {}
