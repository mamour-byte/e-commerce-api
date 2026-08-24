import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
	private readonly logger = new Logger(MailService.name);
	private transporter: nodemailer.Transporter | null = null;
	private readonly from: string;

	constructor(private readonly config: ConfigService) {
		const host = this.config.get<string>('SMTP_HOST');
		const port = this.config.get<number>('SMTP_PORT') || 587;
		const user = this.config.get<string>('SMTP_USER');
		const pass = this.config.get<string>('SMTP_PASS');
		this.from = this.config.get<string>('MAIL_FROM') || 'Hayat Store <noreply@hayatstore.com>';

		if (host && user && pass && !user.includes('your-email')) {
			this.transporter = nodemailer.createTransport({
				host,
				port,
				secure: port === 465,
				auth: { user, pass },
			});
		} else {
			this.logger.warn('SMTP non configuré ou clés par défaut dans .env. Les emails seront journalisés en console.');
		}
	}

	async sendOrderReceipt(order: any) {
		const recipientEmail = order.customerEmail || order.user?.email;

		if (!recipientEmail) {
			this.logger.warn(`Impossible d'envoyer le reçu de commande ${order.orderNumber} : aucune adresse email client fournie.`);
			return false;
		}

		const subject = `Reçu de paiement & Confirmation de votre commande ${order.orderNumber} - Hayat Store`;
		const htmlContent = this.generateReceiptHtml(order);

		if (!this.transporter) {
			this.logger.log(`[SIMULATION EMAIL REÇU ${order.orderNumber}] Destinataire: ${recipientEmail}`);
			this.logger.log(`Montant total: ${order.total} XOF - Statut Paiement: ${order.paymentStatus}`);
			return true;
		}

		try {
			await this.transporter.sendMail({
				from: this.from,
				to: recipientEmail,
				subject,
				html: htmlContent,
			});
			this.logger.log(`Email de confirmation et reçu de paiement envoyé avec succès à ${recipientEmail} (Commande ${order.orderNumber}).`);
			return true;
		} catch (error) {
			this.logger.error(`Échec de l'envoi de l'email à ${recipientEmail} pour la commande ${order.orderNumber}`, error);
			return false;
		}
	}

	private generateReceiptHtml(order: any): string {
		const itemsList = (order.items || [])
			.map(
				(item: any) => `
			<tr>
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee;">
					<strong>${item.productName}</strong> ${item.variantName ? `<br><small style="color: #666;">Variante: ${item.variantName}</small>` : ''}
				</td>
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: center;">${item.quantity}</td>
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right;">${Number(item.unitPrice).toLocaleString()} XOF</td>
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: bold;">${Number(item.total).toLocaleString()} XOF</td>
			</tr>
		`,
			)
			.join('');

		const customerName = `${order.shippingFirstName || ''} ${order.shippingLastName || ''}`.trim() || 'Cher(e) Client(e)';

		return `
		<!DOCTYPE html>
		<html lang="fr">
		<head>
			<meta charset="UTF-8">
			<title>Reçu de paiement - Hayat Store</title>
		</head>
		<body style="font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px;">
			<div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
				<!-- Header -->
				<div style="background-color: #1a202c; color: #ffffff; padding: 25px; text-align: center;">
					<h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">HAYAT STORE</h1>
					<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Merci pour votre achat !</p>
				</div>

				<!-- Content -->
				<div style="padding: 30px;">
					<h2 style="color: #2d3748; margin-top: 0; font-size: 20px;">Confirmation de commande</h2>
					<p style="color: #4a5568; line-height: 1.5;">Bonjour <strong>${customerName}</strong>,</p>
					<p style="color: #4a5568; line-height: 1.5;">
						Nous avons bien reçu le paiement pour votre commande <strong>${order.orderNumber}</strong>. 
						Voici le récapitulatif détaillé de votre reçu :
					</p>

					<!-- Order Info Box -->
					<div style="background-color: #edf2f7; padding: 15px; border-radius: 6px; margin: 20px 0;">
						<p style="margin: 3px 0; color: #2d3748; font-size: 14px;"><strong>Numéro de commande :</strong> ${order.orderNumber}</p>
						<p style="margin: 3px 0; color: #2d3748; font-size: 14px;"><strong>Date :</strong> ${new Date(order.createdAt).toLocaleDateString('fr-FR')}</p>
						<p style="margin: 3px 0; color: #2d3748; font-size: 14px;"><strong>Statut du paiement :</strong> <span style="color: #38a169; font-weight: bold;">PAYÉ (${order.paymentStatus})</span></p>
					</div>

					<!-- Items Table -->
					<h3 style="color: #2d3748; font-size: 16px; margin-top: 25px;">Articles commandés</h3>
					<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
						<thead>
							<tr style="background-color: #f7fafc; text-align: left;">
								<th style="padding: 10px; border-bottom: 2px solid #cbd5e0;">Produit</th>
								<th style="padding: 10px; border-bottom: 2px solid #cbd5e0; text-align: center;">Qté</th>
								<th style="padding: 10px; border-bottom: 2px solid #cbd5e0; text-align: right;">Prix unitaire</th>
								<th style="padding: 10px; border-bottom: 2px solid #cbd5e0; text-align: right;">Total</th>
							</tr>
						</thead>
						<tbody>
							${itemsList}
						</tbody>
					</table>

					<!-- Totals Summary -->
					<div style="margin-top: 20px; text-align: right; font-size: 14px; color: #2d3748;">
						<p style="margin: 4px 0;">Sous-total : <strong>${Number(order.subtotal).toLocaleString()} XOF</strong></p>
						${Number(order.discountAmount) > 0 ? `<p style="margin: 4px 0; color: #e53e3e;">Remise : <strong>-${Number(order.discountAmount).toLocaleString()} XOF</strong></p>` : ''}
						<p style="margin: 4px 0;">Livraison : <strong>${Number(order.shippingAmount).toLocaleString()} XOF</strong></p>
						<h3 style="margin: 10px 0 0 0; color: #1a202c; font-size: 18px;">Total payé : <span style="color: #2b6cb0;">${Number(order.total).toLocaleString()} XOF</span></h3>
					</div>

					<!-- Delivery Address -->
					<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
						<h4 style="margin: 0 0 8px 0; color: #2d3748;">Adresse de livraison</h4>
						<p style="margin: 0; color: #718096; font-size: 14px; line-height: 1.4;">
							${order.shippingAddress || ''}<br>
							${order.shippingCity || ''}, ${order.shippingRegion || ''} ${order.shippingCountry || 'SN'}<br>
							Téléphone: ${order.shippingPhone || order.customerPhone}
						</p>
					</div>
				</div>

				<!-- Footer -->
				<div style="background-color: #f7fafc; padding: 20px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7;">
					<p style="margin: 0;">Hayat Store - Votre boutique e-commerce de confiance</p>
					<p style="margin: 5px 0 0 0;">Si vous avez des questions, contactez notre support.</p>
				</div>
			</div>
		</body>
		</html>
		`;
	}
}
