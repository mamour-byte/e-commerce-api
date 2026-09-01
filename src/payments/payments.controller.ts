import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentsService } from './payments.service';

type AuthUser = { id: string };

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Initialiser un paiement pour une commande (WAVE, ORANGE_MONEY, CASH_ON_DELIVERY)
   */
  @Post('initiate')
  @UseGuards(OptionalJwtAuthGuard)
  initiatePayment(
    @Body() dto: InitiatePaymentDto,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.paymentsService.initiatePayment(user?.id || null, dto);
  }

  /**
   * Obtenir les paiements liés à une commande
   */
  @Get('order/:orderId')
  @UseGuards(OptionalJwtAuthGuard)
  findByOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.paymentsService.findByOrder(orderId, user?.id);
  }

  /**
   * Obtenir les détails d'un paiement
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  /**
   * Webhook public pour recevoir les notifications Wave
   */
  @Post('webhooks/wave')
  @HttpCode(HttpStatus.OK)
  handleWaveWebhook(
    @Headers('wave-signature') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf-8')
      : JSON.stringify(body);
    return this.paymentsService.handleWaveWebhook(
      signature || '',
      rawBody,
      body,
    );
  }

  /**
   * Webhook public pour recevoir les notifications Orange Money
   * (protégé par signature partagée : ORANGE_MONEY_WEBHOOK_SECRET)
   */
  @Post('webhooks/orange-money')
  @HttpCode(HttpStatus.OK)
  handleOrangeMoneyWebhook(
    @Headers('x-orange-money-signature') signature: string,
    @Body() body: any,
  ) {
    return this.paymentsService.handleOrangeMoneyWebhook(body, signature);
  }
}
