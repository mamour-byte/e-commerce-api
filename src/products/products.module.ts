import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsController } from './variants/variants.controller';
import { VariantsService } from './variants/variants.service';
import { ImagesController } from './images/images.controller';
import { ImagesService } from './images/images.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    ProductsController,
    VariantsController,
    ImagesController,
  ],
  providers: [
    ProductsService,
    VariantsService,
    ImagesService,
  ],
  exports: [
    ProductsService,
    VariantsService,
  ],
})
export class ProductsModule {}