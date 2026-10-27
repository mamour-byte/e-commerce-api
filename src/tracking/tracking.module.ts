import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { MetaCapiService } from './services/meta-capi.service';
import { TikTokEventsApiService } from './services/tiktok-events-api.service';
import { GoogleAdsService } from './google-ads.service';
import { TrackingJobsService } from './tracking.jobs';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    MetaCapiService,
    TikTokEventsApiService,
    GoogleAdsService,
    TrackingJobsService,
  ],
  exports: [
    TrackingService,
    MetaCapiService,
    TikTokEventsApiService,
    GoogleAdsService,
  ],
})
export class TrackingModule {}
