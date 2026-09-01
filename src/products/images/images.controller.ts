import {
  BadRequestException,
  Controller,
  Delete,
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
import { ImagesService } from './images.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

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

@Controller('products/:productId/images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post()
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
  upload(
    @Param('productId') productId: string,
    @Query('alt') alt: string | undefined,
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
    return this.imagesService.upload(productId, file, alt);
  }

  @Patch(':id/primary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  setPrimary(@Param('id') id: string) {
    return this.imagesService.setPrimary(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  remove(@Param('id') id: string) {
    return this.imagesService.remove(id);
  }
}
