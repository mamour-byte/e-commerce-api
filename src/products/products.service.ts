import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductStatus } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    let slug = dto.slug || dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) {
      slug = `product-${Date.now()}`;
    }

    const existingSlug = await this.prisma.product.findUnique({
      where: { slug },
    });

    if (existingSlug) {
      if (dto.slug) {
        throw new ConflictException('Un produit avec ce slug existe déjà.');
      } else {
        slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
      }
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

    let categoryId = dto.categoryId && dto.categoryId.trim() !== '' ? dto.categoryId : undefined;
    if (categoryId) {
      const catExists = await this.prisma.category.findUnique({ where: { id: categoryId } });
      if (!catExists) {
        categoryId = undefined;
      }
    }

    let brandId = dto.brandId && dto.brandId.trim() !== '' ? dto.brandId : undefined;
    if (brandId) {
      const brandExists = await this.prisma.brand.findUnique({ where: { id: brandId } });
      if (!brandExists) {
        brandId = undefined;
      }
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug,
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

        categoryId,
        brandId,

        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        ...(dto.imageUrl
          ? {
              images: {
                create: [
                  {
                    url: dto.imageUrl,
                    isPrimary: true,
                  },
                ],
              },
            }
          : {}),
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
      status,
      search,
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      featured,
      page = 1,
      limit = 50,
    } = query;

    const where: any = {
      ...(status && status !== 'ALL' ? { status: status as ProductStatus } : {}),

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