import { Test, TestingModule } from '@nestjs/testing';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

describe('CouponsController', () => {
	let controller: CouponsController;

	const mockCouponsService = {
		validate: jest.fn(),
		create: jest.fn(),
		findAll: jest.fn(),
		findOne: jest.fn(),
		getUsages: jest.fn(),
		update: jest.fn(),
		remove: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [CouponsController],
			providers: [
				{
					provide: CouponsService,
					useValue: mockCouponsService,
				},
			],
		}).compile();

		controller = module.get<CouponsController>(CouponsController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
