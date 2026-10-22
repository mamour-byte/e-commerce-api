import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentsService } from './payments.service';
import type { BictorysWebhookPayload } from './providers/bictorys.service';

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
   * Statut réel du paiement d'une commande (page de retour du paiement).
   * Aucune donnée personnelle n'est exposée : uniquement l'état du paiement.
   * Déclaré AVANT `@Get(':id')` pour ne pas être capté par la route paramétrée.
   */
  @Get('checkout-status')
  getCheckoutStatus(
    @Query('orderId') orderId: string,
    @Query('orderNumber') orderNumber?: string,
  ) {
    return this.paymentsService.getCheckoutStatus(orderId, orderNumber);
  }

  /**
   * Relais de redirection après paiement.
   *
   * Les prestataires (Bictorys, Wave, Orange Money) redirigent le navigateur
   * vers cette route : elle est publique et accessible depuis l'extérieur.
   * L'API répond ensuite par une redirection 302 vers le front
   * (`FRONTEND_BROWSER_URL`), qui peut être une adresse locale en dev.
   */
  @Get('redirect/:kind')
  redirectToCheckout(
    @Param('kind') kind: string,
    @Query('orderId') orderId: string | undefined,
    @Query('orderNumber') orderNumber: string | undefined,
    @Res() res: Response,
  ) {
    const target = this.paymentsService.buildCheckoutRedirectTarget(kind, {
      orderId,
      orderNumber,
    });
    return res.redirect(302, target);
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

  /**
   * Webhook public pour recevoir les notifications Bictorys.
   * La notification est authentifiée par le header `X-Secret-Key`
   * (clé secrète du webhook configurée dans le dashboard Bictorys).
   */
  @Post('webhooks/bictorys')
  @HttpCode(HttpStatus.OK)
  handleBictorysWebhook(
    @Headers('x-secret-key') secret: string,
    @Body() body: BictorysWebhookPayload,
  ) {
    return this.paymentsService.handleBictorysWebhook(body, secret);
  }

  /**
   * Vérification manuelle d'un paiement Bictorys (la confirmation reste
   * conditionnée à une vérification serveur de la transaction).
   */
  @Post('bictorys/verify/:orderId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  verifyBictorysPayment(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.paymentsService.verifyBictorysPayment(
      user?.id || null,
      orderId,
    );
  }
}
