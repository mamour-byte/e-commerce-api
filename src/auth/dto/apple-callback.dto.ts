import { IsOptional, IsString } from 'class-validator';

export class AppleCallbackDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  id_token?: string;

  @IsString()
  @IsOptional()
  state?: string;

  // Apple sends user JSON only on the very first authorization
  @IsString()
  @IsOptional()
  user?: string;
}
