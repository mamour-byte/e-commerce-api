import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ProductsService } from './products.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

import { UserRole } from '@prisma/client';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

type AuthUser = { id: string; role: UserRole };

function isImageBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // JPEG
    (buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47) || // PNG
    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) // WEBP (RIFF)
  );
}

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * PUBLIC (les brouillons ne sont visibles que par ADMIN/STAFF)
   */

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(@Query() query: ProductQueryDto, @CurrentUser() user?: AuthUser) {
    return this.productsService.findAll(query, user?.role);
  }

  @Get('slug/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  findBySlug(@Param('slug') slug: string, @CurrentUser() user?: AuthUser) {
    return this.productsService.findBySlug(slug, user?.role);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.productsService.findOne(id, user?.role);
  }

  /**
   * ADMIN / STAFF
   */

  @Post('upload-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          cb(
            new BadRequestException(
              'Format non supporté. Utilisez JPEG, PNG ou WebP.',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_SIZE_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException(
        'Format non supporté. Utilisez JPEG, PNG ou WebP.',
      );
    }
    if (!isImageBuffer(file.buffer)) {
      throw new BadRequestException(
        'Fichier corrompu ou non conforme (magic bytes invalides).',
      );
    }
    const uploaded = await this.cloudinary.uploadImage(file);
    return {
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
