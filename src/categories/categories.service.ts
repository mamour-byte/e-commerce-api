import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateCategoryDto) {
    let slug = dto.slug || dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) {
      slug = `category-${Date.now()}`;
    }

    const existing = await this.prisma.category.findUnique({
      where: { slug },
    });

    if (existing) {
      if (dto.slug) {
        throw new ConflictException('Une catégorie avec ce slug existe déjà.');
      } else {
        slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
      }
    }

    let parentId = dto.parentId && dto.parentId.trim() !== '' ? dto.parentId : undefined;
    if (parentId) {
      const parentExists = await this.prisma.category.findUnique({ where: { id: parentId } });
      if (!parentExists) {
        parentId = undefined;
      }
    }

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        imageUrl: dto.imageUrl,
        parentId,
        isActive: dto.isActive ?? true,
      },

      include: {
        parent: true,
        children: true,
      },
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: {
        isActive: true,
      },

      include: {
        children: {
          where: {
            isActive: true,
          },
        },

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

  async findTree() {
    return this.prisma.category.findMany({
      where: {
        isActive: true,
        parentId: null,
      },

      include: {
        children: {
          where: {
            isActive: true,
          },

          include: {
            children: {
              where: {
                isActive: true,
              },
            },

            _count: {
              select: {
                products: true,
              },
            },
          },

          orderBy: {
            name: 'asc',
          },
        },

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
    const category = await this.prisma.category.findUnique({
      where: {
        id,
      },

      include: {
        parent: true,
        children: true,

        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(
        'Catégorie introuvable.',
      );
    }

    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existing = await this.prisma.category.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existing) throw new ConflictException('Ce slug est déjà utilisé.');
    }

    if (dto.parentId) {
      if (dto.parentId === id)
        throw new ConflictException('Une catégorie ne peut pas être son propre parent.');
      await this.validateParent(dto.parentId);
    }

    const { name, slug, description, imageUrl, parentId, isActive } = dto;

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(parentId !== undefined && { parentId }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { parent: true, children: true },
    });
  }

  async remove(id: string) {
    const category = await this.findOne(id);

    if (category.children.length > 0) {
      throw new ConflictException(
        'Impossible de supprimer une catégorie contenant des sous-catégories.',
      );
    }

    const productCount = await this.prisma.product.count({
      where: {
        categoryId: id,
      },
    });

    if (productCount > 0) {
      throw new ConflictException(
        'Impossible de supprimer une catégorie contenant des produits.',
      );
    }

    return this.prisma.category.update({
      where: {
        id,
      },

      data: {
        isActive: false,
      },
    });
  }

  private async validateParent(parentId: string) {
    const parent = await this.prisma.category.findUnique({
      where: {
        id: parentId,
      },
    });

    if (!parent) {
      throw new NotFoundException(
        'Catégorie parente introuvable.',
      );
    }

    if (!parent.isActive) {
      throw new ConflictException(
        'La catégorie parente est désactivée.',
      );
    }
  }
}