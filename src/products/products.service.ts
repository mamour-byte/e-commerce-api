import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const existingSlug = await this.prisma.product.findUnique({
      where: {
        slug: dto.slug,
      },
    });

    if (existingSlug) {
      throw new ConflictException(
        'Un produit avec ce slug existe déjà.',
      );
    }

    if (dto.sku) {
      const existingSku = await this.prisma.product.findUnique({
        where: {
          sku: dto.sku,
        },
      });

      if (existingSku) {
        throw new ConflictException(
          'Un produit avec ce SKU existe déjà.',
        );
      }
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        sku: dto.sku,

        description: dto.description,
        shortDescription: dto.shortDescription,

        price: dto.price,
        compareAtPrice: dto.compareAtPrice,
        costPrice: dto.costPrice,

        stock: dto.stock ?? 0,
        lowStockThreshold: dto.lowStockThreshold ?? 5,

        status: dto.status,
        isFeatured: dto.isFeatured ?? false,

        categoryId: dto.categoryId,
        brandId: dto.brandId,

        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
      },
      include: {
        category: true,
        brand: true,
        images: true,
        variants: true,
      },
    });
  }

  async findAll(query: ProductQueryDto) {
    const {
      search,
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      featured,
      page = 1,
      limit = 20,
    } = query;

    const where = {
      status: 'ACTIVE' as const,

      ...(search && {
        OR: [
          {
            name: {
              contains: search,
              mode: 'insensitive' as const,
            },
          },
          {
            description: {
              contains: search,
              mode: 'insensitive' as const,
            },
          },
        ],
      }),

      ...(categoryId && {
        categoryId,
      }),

      ...(brandId && {
        brandId,
      }),

      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            price: {
              ...(minPrice !== undefined && {
                gte: minPrice,
              }),
              ...(maxPrice !== undefined && {
                lte: maxPrice,
              }),
            },
          }
        : {}),

      ...(featured !== undefined && {
        isFeatured: featured,
      }),
    };

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,

        include: {
          images: {
            orderBy: {
              position: 'asc',
            },
          },
          category: true,
          brand: true,
        },

        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.product.count({
        where,
      }),
    ]);

    return {
      data: products,

      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, status: { not: 'ARCHIVED' } },
      include: {
        category: true,
        brand: true,
        images: { orderBy: { position: 'asc' } },
        variants: true,
        reviews: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!product) throw new NotFoundException('Produit introuvable.');
    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: { not: 'ARCHIVED' } },
      include: {
        category: true,
        brand: true,
        images: { orderBy: { position: 'asc' } },
        variants: true,
      },
    });

    if (!product) throw new NotFoundException('Produit introuvable.');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existingSlug = await this.prisma.product.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existingSlug) throw new ConflictException('Ce slug est déjà utilisé.');
    }

    const { name, slug, sku, description, shortDescription, price,
      compareAtPrice, costPrice, stock, lowStockThreshold, status,
      isFeatured, categoryId, brandId, seoTitle, seoDescription } = dto;

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(sku !== undefined && { sku }),
        ...(description !== undefined && { description }),
        ...(shortDescription !== undefined && { shortDescription }),
        ...(price !== undefined && { price }),
        ...(compareAtPrice !== undefined && { compareAtPrice }),
        ...(costPrice !== undefined && { costPrice }),
        ...(stock !== undefined && { stock }),
        ...(lowStockThreshold !== undefined && { lowStockThreshold }),
        ...(status !== undefined && { status }),
        ...(isFeatured !== undefined && { isFeatured }),
        ...(categoryId !== undefined && { categoryId }),
        ...(brandId !== undefined && { brandId }),
        ...(seoTitle !== undefined && { seoTitle }),
        ...(seoDescription !== undefined && { seoDescription }),
      },
      include: {
        category: true,
        brand: true,
        images: true,
        variants: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.product.update({
      where: {
        id,
      },

      data: {
        status: 'ARCHIVED',
      },
    });
  }
}