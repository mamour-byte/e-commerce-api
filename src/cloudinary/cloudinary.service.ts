import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(file: Express.Multer.File): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'ecommerce/products',
          resource_type: 'image',
          transformation: [
            { width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error || !result) {
            reject(new InternalServerErrorException('Upload Cloudinary échoué.'));
            return;
          }
          resolve(result);
        },
      );
      stream.end(file.buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }
}
