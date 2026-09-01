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

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        sku: dto.sku,
        name: dto.name,
        price: dto.price,
        quantity: dto.quantity ?? 0,
        trackInventory: dto.trackInventory ?? true,
        attributes: dto.attributes,
      },
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: { hasVariants: true },
    });

    await this.syncParentStock(productId);

    return variant;
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

    const { sku, name, price, quantity, trackInventory, attributes } = dto;

    const variant = await this.prisma.productVariant.update({
      where: { id },
      data: {
        ...(sku !== undefined && { sku }),
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(quantity !== undefined && { quantity }),
        ...(trackInventory !== undefined && { trackInventory }),
        ...(attributes !== undefined && { attributes }),
      },
    });

    if (quantity !== undefined) {
      await this.syncParentStock(variant.productId);
    }

    return variant;
  }

  async remove(id: string) {
    const variant = await this.findOne(id);
    const deleted = await this.prisma.productVariant.delete({ where: { id } });

    const remainingCount = await this.prisma.productVariant.count({
      where: { productId: variant.productId },
    });

    if (remainingCount === 0) {
      await this.prisma.product.update({
        where: { id: variant.productId },
        data: { hasVariants: false },
      });
    } else {
      await this.syncParentStock(variant.productId);
    }

    return deleted;
  }

  // Garde le champ `quantity` du produit parent synchronisé avec la somme
  // des quantités de ses variantes, pour que `product.quantity` reflète
  // toujours le stock réel vendable.
  private async syncParentStock(productId: string): Promise<void> {
    const aggregate = await this.prisma.productVariant.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        quantity: aggregate._sum.quantity ?? 0,
      },
    });
  }
}