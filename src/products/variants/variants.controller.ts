import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { VariantsService } from './variants.service';

import { CreateProductVariantDto } from '../dto/create-product-variant.dto';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { UserRole } from '@prisma/client';

@Controller('products/:productId/variants')
export class VariantsController {
  constructor(
    private readonly variantsService: VariantsService,
  ) {}

  @Get()
  findByProduct(
    @Param('productId') productId: string,
  ) {
    return this.variantsService.findByProduct(
      productId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.variantsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.variantsService.create(
      productId,
      dto,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return this.variantsService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.variantsService.remove(id);
  }
}