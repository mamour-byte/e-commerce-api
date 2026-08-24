import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateBrandDto) {
    const existing = await this.prisma.brand.findUnique({
      where: {
        slug: dto.slug,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Une marque avec ce slug existe déjà.',
      );
    }

    return this.prisma.brand.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        logoUrl: dto.logoUrl,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll() {
    return this.prisma.brand.findMany({
      where: {
        isActive: true,
      },

      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },

      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: {
        id,
      },

      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!brand) {
      throw new NotFoundException(
        'Marque introuvable.',
      );
    }

    return brand;
  }

  async update(id: string, dto: UpdateBrandDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existing = await this.prisma.brand.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existing) throw new ConflictException('Ce slug est déjà utilisé.');
    }

    const { name, slug, description, logoUrl, isActive } = dto;

    return this.prisma.brand.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(description !== undefined && { description }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { _count: { select: { products: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const productCount =
      await this.prisma.product.count({
        where: {
          brandId: id,
        },
      });

    if (productCount > 0) {
      throw new ConflictException(
        'Impossible de supprimer une marque contenant des produits.',
      );
    }

    return this.prisma.brand.update({
      where: {
        id,
      },

      data: {
        isActive: false,
      },
    });
  }
}