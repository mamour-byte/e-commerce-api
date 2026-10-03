import { Controller, Post, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  IdentifyDto,
  PageViewDto,
  StartSessionDto,
  TrackEventsDto,
  TrackSearchDto,
} from './dto/tracking.dto';
import { TrackingService } from './tracking.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Public()
  @Post('session/start')
  startSession(@Body() dto: StartSessionDto, @Req() req: Request) {
    return this.trackingService.startSession(dto, req);
  }

  @Public()
  @Post('identify')
  identify(@Body() dto: IdentifyDto) {
    return this.trackingService.identify(dto);
  }

  @Public()
  @Post('pageview')
  recordPageView(@Body() dto: PageViewDto, @Req() req: Request) {
    return this.trackingService.recordPageView(dto, req);
  }

  @Public()
  @Post('search')
  recordSearch(@Body() dto: TrackSearchDto) {
    return this.trackingService.recordSearch(dto);
  }

  @Public()
  @Post('events')
  trackEvents(@Body() dto: TrackEventsDto, @Req() req: Request) {
    return this.trackingService.trackEvents(dto, req);
  }
}
