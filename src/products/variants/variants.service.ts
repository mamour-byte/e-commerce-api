import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import { CreateProductVariantDto } from '../dto/create-product-variant.dto';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto';

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    productId: string,
    dto: CreateProductVariantDto,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produit introuvable.');

    const existing = await this.prisma.productVariant.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException('Ce SKU est déjà utilisé.');

    return this.prisma.productVariant.create({
      data: {
        productId,
        sku: dto.sku,
        name: dto.name,
        price: dto.price,
        stock: dto.stock ?? 0,
        attributes: dto.attributes,
      },
    });
  }

  async findByProduct(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!variant) throw new NotFoundException('Variante introuvable.');
    return variant;
  }

  async update(id: string, dto: UpdateProductVariantDto) {
    await this.findOne(id);

    if (dto.sku) {
      const existing = await this.prisma.productVariant.findFirst({
        where: { sku: dto.sku, NOT: { id } },
      });
      if (existing) throw new ConflictException('Ce SKU est déjà utilisé.');
    }

    const { sku, name, price, stock, attributes } = dto;

    return this.prisma.productVariant.update({
      where: { id },
      data: {
        ...(sku !== undefined && { sku }),
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(stock !== undefined && { stock }),
        ...(attributes !== undefined && { attributes }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.productVariant.delete({ where: { id } });
  }
}