import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { ReceiveInventoryDto } from './dto/receive-inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // VUE D'ENSEMBLE DU STOCK
  // ─────────────────────────────────────────────────────────────────────────

  async overview() {
    const products = await this.prisma.product.findMany({
      select: {
        id: true,
        name: true,
        sku: true,
        status: true,
        trackInventory: true,
        quantity: true,
        hasVariants: true,
        variants: {
          select: {
            id: true,
            name: true,
            sku: true,
            trackInventory: true,
            quantity: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => {
      const base = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        status: p.status,
        trackInventory: p.trackInventory,
        quantity: p.quantity,
        stockState: !p.trackInventory
          ? 'NOT_TRACKED'
          : p.quantity <= 0
            ? 'OUT_OF_STOCK'
            : 'IN_STOCK',
      };

      return p.hasVariants
        ? {
            ...base,
            variants: p.variants.map((v) => ({
              id: v.id,
              name: v.name,
              sku: v.sku,
              trackInventory: v.trackInventory,
              quantity: v.quantity,
              isActive: v.isActive,
              stockState: !v.trackInventory
                ? 'NOT_TRACKED'
                : v.quantity <= 0
                  ? 'OUT_OF_STOCK'
                  : 'IN_STOCK',
            })),
          }
        : base;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AJUSTEMENT MANUEL (inventaire physique, casse, etc.)
  // ─────────────────────────────────────────────────────────────────────────

  async adjust(userId: string, dto: AdjustInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getStockRow(tx, dto.productId, dto.variantId);

      if (!current.trackInventory) {
        throw new BadRequestException(
          "Ce produit n'est pas soumis à la gestion de stock (trackInventory = false).",
        );
      }

      if (dto.newQuantity < 0) {
        throw new BadRequestException(
          "La nouvelle quantité ne peut pas être négative.",
        );
      }

      const delta = dto.newQuantity - current.quantity;

      await this.updateStock(tx, dto.productId, dto.variantId, {
        quantity: dto.newQuantity,
      });

      const referenceId = dto.productId;
      const referenceType = 'INVENTORY';

      if (dto.variantId) {
        await tx.inventoryMovement.create({
          data: {
            quantity: delta,
            type: InventoryMovementType.ADJUSTMENT,
            reason: dto.reason || 'Ajustement manuel du stock',
            productId: dto.productId,
            variantId: dto.variantId,
            referenceId,
            referenceType,
            createdById: userId,
          },
        });
      } else {
        await tx.inventoryMovement.create({
          data: {
            quantity: delta,
            type: InventoryMovementType.ADJUSTMENT,
            reason: dto.reason || 'Ajustement manuel du stock',
            productId: dto.productId,
            referenceId,
            referenceType,
            createdById: userId,
          },
        });
      }

      return { productId: dto.productId, variantId: dto.variantId ?? null, quantity: dto.newQuantity, delta };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RÉCEPTION FOURNISSEUR (entrée de marchandise)
  // ─────────────────────────────────────────────────────────────────────────

  async receive(userId: string, dto: ReceiveInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getStockRow(tx, dto.productId, dto.variantId);

      if (!current.trackInventory) {
        throw new BadRequestException(
          "Ce produit n'est pas soumis à la gestion de stock (trackInventory = false).",
        );
      }

      const newQuantity = current.quantity + dto.quantity;

      await this.updateStock(tx, dto.productId, dto.variantId, {
        quantity: newQuantity,
      });

      const referenceId = dto.productId;
      const referenceType = 'INVENTORY';

      if (dto.variantId) {
        await tx.inventoryMovement.create({
          data: {
            quantity: dto.quantity,
            type: InventoryMovementType.PURCHASE,
            reason: dto.reason || 'Réception de marchandise',
            productId: dto.productId,
            variantId: dto.variantId,
            referenceId,
            referenceType,
            createdById: userId,
          },
        });
      } else {
        await tx.inventoryMovement.create({
          data: {
            quantity: dto.quantity,
            type: InventoryMovementType.PURCHASE,
            reason: dto.reason || 'Réception de marchandise',
            productId: dto.productId,
            referenceId,
            referenceType,
            createdById: userId,
          },
        });
      }

      return { productId: dto.productId, variantId: dto.variantId ?? null, quantity: newQuantity, added: dto.quantity };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HISTORIQUE DES MOUVEMENTS
  // ─────────────────────────────────────────────────────────────────────────

  async movements(query: InventoryQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryMovementWhereInput = {
      ...(query.productId && { productId: query.productId }),
      ...(query.type && {
        type: query.type as InventoryMovementType,
      }),
    };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, name: true, sku: true } },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        pageCount: Math.ceil(total / limit),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async getStockRow(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId?: string,
  ): Promise<{ quantity: number; trackInventory: boolean }> {
    if (variantId) {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId, productId },
        select: { quantity: true, trackInventory: true },
      });
      if (!variant) throw new NotFoundException('Variante introuvable.');
      return variant;
    }

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { quantity: true, trackInventory: true },
    });
    if (!product) throw new NotFoundException('Produit introuvable.');
    return product;
  }

  private async updateStock(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId: string | undefined,
    data: { quantity: number },
  ) {
    if (variantId) {
      await tx.productVariant.update({ where: { id: variantId }, data });
      await this.syncParentStock(tx, productId);
    } else {
      await tx.product.update({ where: { id: productId }, data });
    }
  }

  // Garde le champ `quantity` du produit parent synchronisé avec la somme de
  // ses variantes, pour que `product.quantity` reflète toujours le stock réel
  // vendable (les produits à variantes mutent la quantité des seules
  // variantes, jamais celle du parent).
  private async syncParentStock(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { hasVariants: true },
    });
    if (!product?.hasVariants) {
      return;
    }

    const aggregate = await tx.productVariant.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });

    await tx.product.update({
      where: { id: productId },
      data: {
        quantity: aggregate._sum.quantity ?? 0,
      },
    });
  }
}
