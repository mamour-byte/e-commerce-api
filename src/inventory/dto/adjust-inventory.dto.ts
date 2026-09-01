import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AdjustInventoryDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(0)
  newQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
