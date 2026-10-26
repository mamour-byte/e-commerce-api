import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentsJobsService {
  private readonly logger = new Logger(PaymentsJobsService.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Vérifie les paiements dont la fenêtre est dépassée : confirmation si le
   * prestataire a réussi, échec si refusé, expiration après le délai de grâce.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcileAbandonedPayments() {
    try {
      const summary = await this.paymentsService.expireAbandonedPayments();

      if (summary.checked > 0) {
        this.logger.log(
          `Réconciliation paiements : ${summary.checked} vérifié(s), ` +
            `${summary.paid} confirmé(s), ${summary.failed} échoué(s), ` +
            `${summary.expired} expiré(s), ${summary.pending} en attente, ` +
            `${summary.errors} erreur(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Réconciliation des paiements impossible : ${(error as Error).message}`,
      );
    }
  }
}
