import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { Prisma, ProductStatus, UserRole } from '@prisma/client';

function isStaffRole(role?: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.STAFF;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(dto: CreateProductDto, file?: Express.Multer.File) {
    let slug =
      dto.slug ||
      dto.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
    if (!slug) {
      slug = `product-${Date.now()}`;
    }

    const existingSlug = await this.prisma.product.findUnique({
      where: { slug },
    });

    if (existingSlug) {
      if (dto.slug != null && dto.slug !== '') {
        throw new ConflictException('Un produit avec ce slug existe déjà.');
      } else {
        slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
      }
    }

    if (dto.sku != null && dto.sku !== '') {
      const existingSku = await this.prisma.product.findUnique({
        where: {
          sku: dto.sku,
        },
      });

      if (existingSku) {
        throw new ConflictException('Un produit avec ce SKU existe déjà.');
      }
    }

    let categoryId =
      dto.categoryId && dto.categoryId.trim() !== ''
        ? dto.categoryId
        : undefined;
    if (categoryId) {
      const catExists = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!catExists) {
        categoryId = undefined;
      }
    }

    let brandId =
      dto.brandId && dto.brandId.trim() !== '' ? dto.brandId : undefined;
    if (brandId) {
      const brandExists = await this.prisma.brand.findUnique({
        where: { id: brandId },
      });
      if (!brandExists) {
        brandId = undefined;
      }
    }

    let uploaded: { secure_url: string; public_id: string } | null = null;
    if (file) {
      this.assertValidImage(file);
      uploaded = await this.cloudinary.uploadImage(file);
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug,
        sku: dto.sku || null,

        description: dto.description,
        shortDescription: dto.shortDescription,

        price: dto.price,
        compareAtPrice: dto.compareAtPrice,
        costPrice: dto.costPrice,

        quantity: dto.quantity ?? 0,
        trackInventory: dto.trackInventory ?? true,

        status: dto.status,
        isFeatured: dto.isFeatured ?? false,

        categoryId,
        brandId,

        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        ...(uploaded
          ? {
              images: {
                create: [
                  {
                    url: uploaded.secure_url,
                    publicId: uploaded.public_id,
                    isPrimary: true,
                  },
                ],
              },
            }
          : dto.imageUrl
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

  async findAll(query: ProductQueryDto, viewerRole?: UserRole) {
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

    const isStaff = isStaffRole(viewerRole);

    const where: Prisma.ProductWhereInput = {
      // Le catalogue public n'expose que les produits ACTIVE.
      // Seuls ADMIN/STAFF peuvent filtrer sur tous les statuts (DRAFT…).
      status:
        status && status !== 'ALL'
          ? (status as ProductStatus)
          : isStaff
            ? undefined
            : ProductStatus.ACTIVE,

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

        omit: isStaff ? undefined : { costPrice: true },

        include: {
          images: {
            orderBy: {
              position: 'asc',
            },
          },
          category: true,
          brand: true,
          variants: true,
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

  async findOne(id: string, viewerRole?: UserRole) {
    const isStaff = isStaffRole(viewerRole);

    const product = await this.prisma.product.findFirst({
      where: {
        id,
        ...(isStaff
          ? { status: { not: 'ARCHIVED' } }
          : { status: ProductStatus.ACTIVE }),
      },

      omit: isStaff ? undefined : { costPrice: true },

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

  async findBySlug(slug: string, viewerRole?: UserRole) {
    const isStaff = isStaffRole(viewerRole);

    const product = await this.prisma.product.findFirst({
      where: {
        slug,
        ...(isStaff
          ? { status: { not: 'ARCHIVED' } }
          : { status: ProductStatus.ACTIVE }),
      },

      omit: isStaff ? undefined : { costPrice: true },

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

  async update(id: string, dto: UpdateProductDto, file?: Express.Multer.File) {
    await this.findOne(id, UserRole.ADMIN);

    if (dto.slug) {
      const existingSlug = await this.prisma.product.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existingSlug)
        throw new ConflictException('Ce slug est déjà utilisé.');
    }

    if (dto.sku != null && dto.sku !== '') {
      const existingSku = await this.prisma.product.findFirst({
        where: { sku: dto.sku, NOT: { id } },
      });
      if (existingSku) throw new ConflictException('Ce SKU est déjà utilisé.');
    }

    const {
      name,
      slug,
      sku,
      description,
      shortDescription,
      price,
      compareAtPrice,
      costPrice,
      quantity,
      trackInventory,
      status,
      isFeatured,
      categoryId,
      brandId,
      seoTitle,
      seoDescription,
    } = dto;

    let uploaded: { secure_url: string; public_id: string } | null = null;
    if (file) {
      this.assertValidImage(file);
      uploaded = await this.cloudinary.uploadImage(file);
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(slug !== undefined && { slug }),
          ...(sku !== undefined && { sku: sku || null }),
          ...(description !== undefined && { description }),
          ...(shortDescription !== undefined && { shortDescription }),
          ...(price !== undefined && { price }),
          ...(compareAtPrice !== undefined && { compareAtPrice }),
          ...(costPrice !== undefined && { costPrice }),
          ...(quantity !== undefined && { quantity }),
          ...(trackInventory !== undefined && { trackInventory }),
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

      if (uploaded) {
        const imageCount = await tx.productImage.count({
          where: { productId: id },
        });
        await tx.productImage.create({
          data: {
            productId: id,
            url: uploaded.secure_url,
            publicId: uploaded.public_id,
            position: imageCount,
            isPrimary: imageCount === 0,
          },
        });
        product.images = await tx.productImage.findMany({
          where: { productId: id },
          orderBy: { position: 'asc' },
        });
      }

      return product;
    });
  }

  async remove(id: string) {
    await this.findOne(id, UserRole.ADMIN);

    return this.prisma.product.update({
      where: {
        id,
      },

      data: {
        status: 'ARCHIVED',
      },
    });
  }

  private assertValidImage(file: Express.Multer.File): void {
    const allowed = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException(
        'Format non supporté. Utilisez JPEG, PNG ou WebP.',
      );
    }
    const buf = file.buffer;
    const isImage =
      buf &&
      buf.length >= 12 &&
      ((buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
        (buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47) ||
        (buf[0] === 0x52 &&
          buf[1] === 0x49 &&
          buf[2] === 0x46 &&
          buf[3] === 0x46));
    if (!isImage) {
      throw new BadRequestException(
        'Fichier corrompu ou non conforme (magic bytes invalides).',
      );
    }
  }
}
