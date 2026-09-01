import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { InventoryService } from './inventory.service';

import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { ReceiveInventoryDto } from './dto/receive-inventory.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

import { UserRole } from '@prisma/client';

type AuthUser = { id: string; role: UserRole };

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.STAFF)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  overview() {
    return this.inventoryService.overview();
  }

  @Get('movements')
  movements(@Query() query: InventoryQueryDto) {
    return this.inventoryService.movements(query);
  }

  @Post('adjust')
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustInventoryDto) {
    return this.inventoryService.adjust(user.id, dto);
  }

  @Post('receive')
  receive(@CurrentUser() user: AuthUser, @Body() dto: ReceiveInventoryDto) {
    return this.inventoryService.receive(user.id, dto);
  }
}
