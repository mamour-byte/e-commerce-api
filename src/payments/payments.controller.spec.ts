import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
	let controller: PaymentsController;

	const mockPaymentsService = {
		initiatePayment: jest.fn(),
		findByOrder: jest.fn(),
		findOne: jest.fn(),
		handleWaveWebhook: jest.fn(),
		handleOrangeMoneyWebhook: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PaymentsController],
			providers: [
				{
					provide: PaymentsService,
					useValue: mockPaymentsService,
				},
			],
		}).compile();

		controller = module.get<PaymentsController>(PaymentsController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
