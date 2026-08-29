import { Test, TestingModule } from '@nestjs/testing';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';

describe('ShippingController', () => {
	let controller: ShippingController;

	const mockShippingService = {
		findAllZones: jest.fn(),
		createZone: jest.fn(),
		findZoneOne: jest.fn(),
		updateZone: jest.fn(),
		removeZone: jest.fn(),
		findAllNeighborhoods: jest.fn(),
		findActiveNeighborhood: jest.fn(),
		findNeighborhoodOne: jest.fn(),
		createNeighborhood: jest.fn(),
		updateNeighborhood: jest.fn(),
		removeNeighborhood: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ShippingController],
			providers: [
				{ provide: ShippingService, useValue: mockShippingService },
			],
		}).compile();

		controller = module.get<ShippingController>(ShippingController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	it('should return active zones', async () => {
		mockShippingService.findAllZones.mockResolvedValue([]);
		const res = await controller.findActiveZones();
		expect(mockShippingService.findAllZones).toHaveBeenCalledWith(false);
		expect(res).toEqual([]);
	});

	it('should return active neighborhoods', async () => {
		mockShippingService.findAllNeighborhoods.mockResolvedValue([]);
		const res = await controller.findActiveNeighborhoods();
		expect(mockShippingService.findAllNeighborhoods).toHaveBeenCalledWith(false, undefined);
		expect(res).toEqual([]);
	});
});
