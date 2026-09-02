import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

@Injectable()
export class MailService {
	private readonly logger = new Logger(MailService.name);
	private transporter: nodemailer.Transporter | null = null;
	private readonly from: string;

	constructor(private readonly config: ConfigService) {
		const host = this.config.get<string>('SMTP_HOST');
		const port = Number(this.config.get<string | number>('SMTP_PORT')) || 587;
		const user = this.config.get<string>('SMTP_USER');
		const pass = this.config.get<string>('SMTP_PASS');
		this.from = this.config.get<string>('MAIL_FROM') || 'Hayat Store <noreply@hayatstore.com>';

		if (host && user && pass && !user.includes('your-email')) {
			const secure = port === 465;
			this.transporter = nodemailer.createTransport({
				host,
				port,
				secure,
				requireTLS: !secure && port === 587,
				auth: { user, pass },
				tls: {
					// Certains hébergeurs (LWS, etc.) utilisent des certificats
					// dont le CN ne matche pas exactement le hostname SMTP.
					rejectUnauthorized: false,
				},
				family: 4,
				connectionTimeout: 15000,
				greetingTimeout: 15000,
				socketTimeout: 15000,
			} as nodemailer.TransportOptions);
			this.logger.log(`SMTP configuré : ${host}:${port} (secure=${secure})`);
		} else {
			this.logger.warn('SMTP non configuré ou clés par défaut dans .env. Les emails seront journalisés en console.');
		}
	}

	private formatAmount(value: unknown): string {
		return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
	}

	private generateInvoicePdf(order: any): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const doc = new PDFDocument({ margin: 50, size: 'A4' });
			const chunks: Buffer[] = [];
			doc.on('data', (chunk) => chunks.push(chunk));
			doc.on('end', () => resolve(Buffer.concat(chunks)));
			doc.on('error', reject);

			const customerName = `${order.shippingFirstName || ''} ${order.shippingLastName || ''}`.trim() || 'Client';

			// En-tête
			doc.fontSize(20).font('Helvetica-Bold').text('HAYAT STORE', { align: 'center' });
			doc.fontSize(12).font('Helvetica').text('Facture / Reçu de paiement', { align: 'center' });
			doc.moveDown();

			// Infos commande
			doc.fontSize(10);
			doc.text(`Numéro de commande : ${order.orderNumber}`);
			doc.text(`Date : ${new Date(order.createdAt).toLocaleDateString('fr-FR')}`);
			doc.text(`Client : ${customerName}`);
			doc.text(`Statut paiement : PAYÉ`);
			doc.moveDown();

			// Tableau des articles
			doc.font('Helvetica-Bold').text('Produit', 50, doc.y, { width: 220, continued: false });
			const headerY = doc.y - doc.currentLineHeight();
			doc.text('Qté', 270, headerY, { width: 50 });
			doc.text('Prix unit.', 320, headerY, { width: 100 });
			doc.text('Total', 420, headerY, { width: 100, align: 'right' });
			doc.moveDown(0.5);
			doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
			doc.moveDown(0.5);

			doc.font('Helvetica').fontSize(9);
			for (const item of order.items || []) {
				const rowY = doc.y;
				const label = item.variantName ? `${item.productName} (${item.variantName})` : item.productName;
				doc.text(label, 50, rowY, { width: 215 });
				doc.text(String(item.quantity), 270, rowY, { width: 50 });
				doc.text(`${this.formatAmount(item.unitPrice)} XOF`, 320, rowY, { width: 100 });
				doc.text(`${this.formatAmount(item.total)} XOF`, 420, rowY, { width: 100, align: 'right' });
				doc.moveDown(0.3);
			}

			doc.moveDown(0.5);
			doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
			doc.moveDown(0.5);

			// Totaux
			doc.fontSize(10);
			doc.text(`Sous-total : ${this.formatAmount(order.subtotal)} XOF`, { align: 'right' });
			if (Number(order.discountAmount) > 0) {
				doc.text(`Remise : -${this.formatAmount(order.discountAmount)} XOF`, { align: 'right' });
			}
			doc.text(`Livraison : ${this.formatAmount(order.shippingAmount)} XOF`, { align: 'right' });
			doc.font('Helvetica-Bold').text(`TOTAL PAYÉ : ${this.formatAmount(order.total)} XOF`, { align: 'right' });

			doc.end();
		});
	}

	async sendPaymentConfirmation(order: any) {
		const recipientEmail = order.customerEmail || order.user?.email;

		if (!recipientEmail) {
			this.logger.warn(`Impossible d'envoyer la confirmation de paiement pour ${order.orderNumber} : aucune adresse email.`);
			return false;
		}

		const subject = `Paiement confirmé - Commande ${order.orderNumber} - Hayat Store`;
		const htmlContent = this.generateReceiptHtml(order);
		const pdfBuffer = await this.generateInvoicePdf(order);

		if (!this.transporter) {
			this.logger.log(`[SIMULATION EMAIL PAIEMENT CONFIRMÉ ${order.orderNumber}] Destinataire: ${recipientEmail}`);
			return true;
		}

		try {
			await this.transporter.sendMail({
				from: this.from,
				to: recipientEmail,
				subject,
				html: htmlContent,
				attachments: [{
					filename: `facture-${order.orderNumber}.pdf`,
					content: pdfBuffer,
					contentType: 'application/pdf',
				}],
			});
			this.logger.log(`Email de confirmation de paiement envoyé à ${recipientEmail} (Commande ${order.orderNumber}).`);
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
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right;">${this.formatAmount(item.unitPrice)} XOF</td>
				<td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: bold;">${this.formatAmount(item.total)} XOF</td>
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
						<p style="margin: 4px 0;">Sous-total : <strong>${this.formatAmount(order.subtotal)} XOF</strong></p>
						${Number(order.discountAmount) > 0 ? `<p style="margin: 4px 0; color: #e53e3e;">Remise : <strong>-${this.formatAmount(order.discountAmount)} XOF</strong></p>` : ''}
						<p style="margin: 4px 0;">Livraison : <strong>${this.formatAmount(order.shippingAmount)} XOF</strong></p>
						<h3 style="margin: 10px 0 0 0; color: #1a202c; font-size: 18px;">Total payé : <span style="color: #2b6cb0;">${this.formatAmount(order.total)} XOF</span></h3>
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

	async sendPasswordResetEmail(email: string, firstName: string | null, resetUrl: string): Promise<boolean> {
		const subject = 'Réinitialisation de votre mot de passe - Hayat Store';
		const htmlContent = this.generatePasswordResetHtml(firstName, resetUrl);

		if (!this.transporter) {
			this.logger.log(`[SIMULATION EMAIL RESET PASSWORD] Destinataire: ${email} | URL: ${resetUrl}`);
			return true;
		}

		try {
			await this.transporter.sendMail({
				from: this.from,
				to: email,
				subject,
				html: htmlContent,
			});
			this.logger.log(`Email de réinitialisation de mot de passe envoyé à ${email}.`);
			return true;
		} catch (error) {
			this.logger.error(`Échec de l'envoi de l'email de réinitialisation à ${email}`, error);
			return false;
		}
	}

	async sendWelcomeEmail(
		email: string,
		firstName: string | null,
	): Promise<boolean> {
		const subject = 'Bienvenue chez Hayat Store !';
		const htmlContent = this.generateWelcomeHtml(firstName);

		if (!this.transporter) {
			this.logger.log(`[SIMULATION EMAIL BIENVENUE] Destinataire: ${email}`);
			return true;
		}

		try {
			await this.transporter.sendMail({
				from: this.from,
				to: email,
				subject,
				html: htmlContent,
			});
			this.logger.log(`Email de bienvenue envoyé à ${email}.`);
			return true;
		} catch (error) {
			this.logger.error(`Échec de l'envoi de l'email de bienvenue à ${email}`, error);
			return false;
		}
	}

	private generateWelcomeHtml(firstName: string | null): string {
		const name = firstName || 'Cher(e) Client(e)';
		return `
		<!DOCTYPE html>
		<html lang="fr">
		<head>
			<meta charset="UTF-8">
			<title>Bienvenue chez Hayat Store</title>
		</head>
		<body style="font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px;">
			<div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
				<!-- Header -->
				<div style="background-color: #1a202c; color: #ffffff; padding: 25px; text-align: center;">
					<h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">HAYAT STORE</h1>
					<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Bienvenue !</p>
				</div>

				<!-- Content -->
				<div style="padding: 30px;">
					<h2 style="color: #2d3748; margin-top: 0; font-size: 20px;">Bonjour <strong>${name}</strong> 👋</h2>
					<p style="color: #4a5568; line-height: 1.6;">
						Votre compte a été créé avec succès sur <strong>Hayat Store</strong>.
						Nous sommes ravis de vous compter parmi nos clients.
					</p>
					<p style="color: #4a5568; line-height: 1.6;">
						Découvrez toute notre sélection de produits et profitez de nos offres exclusives.
						Vous pouvez passer commande et suivre vos achats directement depuis votre compte.
					</p>

					<!-- CTA Button -->
					<div style="text-align: center; margin: 30px 0;">
						<a href="https://hayatstore-five.vercel.app" style="display: inline-block; background-color: #2b6cb0; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: bold;">
							Commencer mes achats
						</a>
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

	private generatePasswordResetHtml(firstName: string | null, resetUrl: string): string {
		const name = firstName || 'Cher(e) Client(e)';
		return `
		<!DOCTYPE html>
		<html lang="fr">
		<head>
			<meta charset="UTF-8">
			<title>Réinitialisation de mot de passe - Hayat Store</title>
		</head>
		<body style="font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px;">
			<div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
				<!-- Header -->
				<div style="background-color: #1a202c; color: #ffffff; padding: 25px; text-align: center;">
					<h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">HAYAT STORE</h1>
					<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Réinitialisation de mot de passe</p>
				</div>

				<!-- Content -->
				<div style="padding: 30px;">
					<h2 style="color: #2d3748; margin-top: 0; font-size: 20px;">Mot de passe oublié ?</h2>
					<p style="color: #4a5568; line-height: 1.6;">Bonjour <strong>${name}</strong>,</p>
					<p style="color: #4a5568; line-height: 1.6;">
						Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte.
						Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :
					</p>

					<!-- CTA Button -->
					<div style="text-align: center; margin: 30px 0;">
						<a href="${resetUrl}" style="display: inline-block; background-color: #2b6cb0; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: bold;">
							Réinitialiser mon mot de passe
						</a>
					</div>

					<!-- Expiration notice -->
					<div style="background-color: #fff5f5; border-left: 4px solid #e53e3e; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 20px 0;">
						<p style="margin: 0; color: #c53030; font-size: 14px;">
							<strong>⏰ Ce lien expire dans 1 heure.</strong> Passé ce délai, vous devrez faire une nouvelle demande.
						</p>
					</div>

					<!-- Security notice -->
					<p style="color: #718096; font-size: 13px; line-height: 1.5; margin-top: 25px;">
						Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email en toute sécurité.
						Votre mot de passe actuel restera inchangé.
					</p>

					<!-- Fallback link -->
					<p style="color: #a0aec0; font-size: 12px; line-height: 1.5; margin-top: 20px;">
						Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
						<a href="${resetUrl}" style="color: #2b6cb0; word-break: break-all;">${resetUrl}</a>
					</p>
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
