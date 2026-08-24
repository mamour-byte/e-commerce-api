import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaveService } from './providers/wave.service';
import { OrangeMoneyService } from './providers/orange-money.service';
import { MailService } from '../mail/mail.service';

describe('PaymentsService', () => {
	let service: PaymentsService;

	const mockPrismaService = {
		payment: {
			create: jest.fn(),
			findFirst: jest.fn(),
			findUnique: jest.fn(),
			findMany: jest.fn(),
			update: jest.fn(),
		},
		order: {
			findUnique: jest.fn(),
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		$transaction: jest.fn((cb) => cb(mockPrismaService)),
	};

	const mockWaveService = {
		createCheckoutSession: jest.fn(),
		verifyWebhookSignature: jest.fn(),
	};

	const mockOrangeMoneyService = {
		initiateWebPayment: jest.fn(),
	};

	const mockMailService = {
		sendOrderReceipt: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PaymentsService,
				{ provide: PrismaService, useValue: mockPrismaService },
				{ provide: WaveService, useValue: mockWaveService },
				{ provide: OrangeMoneyService, useValue: mockOrangeMoneyService },
				{ provide: MailService, useValue: mockMailService },
			],
		}).compile();

		service = module.get<PaymentsService>(PaymentsService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
