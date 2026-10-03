import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TrackingEventName } from '@prisma/client';

const MAX_EVENTS_PER_BATCH = 50;

export class ClickIdsDto {
  @IsString()
  @MaxLength(512)
  @IsOptional()
  fbclid?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  gclid?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  gbraid?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  wbraid?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  ttclid?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  msclkid?: string;
}

export class StartSessionDto extends ClickIdsDto {
  @IsString()
  @Length(8, 128)
  anonymousId: string;

  @IsString()
  @Length(8, 128)
  sessionKey: string;

  @IsString()
  @MaxLength(2048)
  landingPage: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  pagePath?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  referrer?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  userAgent?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmSource?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmMedium?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmCampaign?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmContent?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmTerm?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  utmId?: string;

  @IsString()
  @MaxLength(512)
  @IsOptional()
  fbc?: string;

  @IsString()
  @MaxLength(512)
  @IsOptional()
  fbp?: string;

  @IsBoolean()
  consentGranted: boolean;
}

export class TrackEventDto {
  @IsString()
  @Length(8, 128)
  eventId: string;

  @IsEnum(TrackingEventName)
  name: TrackingEventName;

  @IsDateString()
  @IsOptional()
  eventTime?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  pagePath?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  pageUrl?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  referrer?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  productId?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  variantId?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  orderId?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  searchQuery?: string;

  @IsInt()
  @Min(1)
  @Max(999)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  value?: number;
}

export class TrackEventsDto {
  @IsString()
  @Length(8, 128)
  sessionKey: string;

  @IsString()
  @Length(8, 128)
  @IsOptional()
  anonymousId?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  userId?: string;

  @IsArray()
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events: TrackEventDto[];
}

export class IdentifyDto {
  @IsString()
  @Length(8, 128)
  anonymousId: string;

  @IsString()
  @Length(8, 128)
  @IsOptional()
  sessionKey?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  userId?: string;

  @IsString()
  @MaxLength(256)
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  phone?: string;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  firstName?: string;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  lastName?: string;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(2)
  @IsOptional()
  country?: string;

  @IsString()
  @MaxLength(512)
  @IsOptional()
  fbc?: string;

  @IsString()
  @MaxLength(512)
  @IsOptional()
  fbp?: string;
}

export class TrackSearchDto {
  @IsString()
  @Length(8, 128)
  sessionKey: string;

  @IsString()
  @Length(1, 120)
  query: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  resultCount: number;
}

export class PageViewDto {
  @IsString()
  @Length(8, 128)
  sessionKey: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  pagePath?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  pageUrl?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  referrer?: string;
}
