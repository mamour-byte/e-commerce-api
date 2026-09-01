import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  constructor(private readonly config: ConfigService) {
    const cloudinaryUrl = this.config.get<string>('CLOUDINARY_URL');
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');

    if (cloudinaryUrl) {
      try {
        const parsed = new URL(cloudinaryUrl);
        const parsedCloudName = parsed.host;
        const parsedApiKey = parsed.username;
        const parsedApiSecret = decodeURIComponent(parsed.password);

        if (parsedCloudName && parsedApiKey && parsedApiSecret) {
          cloudinary.config({
            cloud_name: parsedCloudName,
            api_key: parsedApiKey,
            api_secret: parsedApiSecret,
            secure: true,
          });
          return;
        }
      } catch {
        // fallback below
      }
    }

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      return;
    }

    throw new Error(
      'Cloudinary configuration missing. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.',
    );
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
