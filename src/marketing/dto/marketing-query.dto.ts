import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { TrafficPlatform } from '@prisma/client';

export enum MarketingGroupBy {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class MarketingQueryDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(TrafficPlatform)
  @IsOptional()
  platform?: TrafficPlatform;

  @IsEnum(MarketingGroupBy)
  @IsOptional()
  groupBy?: MarketingGroupBy = MarketingGroupBy.DAY;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  limit?: number = 30;
}
