import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

@Injectable()
export class ImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async upload(productId: string, file: Express.Multer.File, alt?: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: { not: 'ARCHIVED' } },
    });
    if (!product) throw new NotFoundException('Produit introuvable.');

    const uploaded = await this.cloudinary.uploadImage(file);

    const imageCount = await this.prisma.productImage.count({ where: { productId } });

    return this.prisma.productImage.create({
      data: {
        productId,
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        alt,
        position: imageCount,
        isPrimary: imageCount === 0,
      },
    });
  }

  async setPrimary(id: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('Image introuvable.');

    await this.prisma.productImage.updateMany({
      where: { productId: image.productId },
      data: { isPrimary: false },
    });

    return this.prisma.productImage.update({
      where: { id },
      data: { isPrimary: true },
    });
  }

  async remove(id: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('Image introuvable.');

    if (image.publicId) {
      await this.cloudinary.deleteImage(image.publicId);
    }

    const deleted = await this.prisma.productImage.delete({ where: { id } });

    // Si l'image supprimée était primaire, promouvoir la première restante
    if (image.isPrimary) {
      const first = await this.prisma.productImage.findFirst({
        where: { productId: image.productId },
        orderBy: { position: 'asc' },
      });
      if (first) {
        await this.prisma.productImage.update({
          where: { id: first.id },
          data: { isPrimary: true },
        });
      }
    }

    return deleted;
  }
}
