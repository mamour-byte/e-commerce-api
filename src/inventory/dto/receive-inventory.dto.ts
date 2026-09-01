import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReceiveInventoryDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
