import { Test, TestingModule } from '@nestjs/testing';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ShippingService', () => {
	let service: ShippingService;

	const mockPrismaService = {
		deliveryZone: {
			create: jest.fn(),
			findMany: jest.fn(),
			findUnique: jest.fn(),
			findFirst: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
		deliveryNeighborhood: {
			create: jest.fn(),
			findMany: jest.fn(),
			findUnique: jest.fn(),
			findFirst: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
		order: {
			count: jest.fn(),
		},
		$transaction: jest.fn((promises) => Promise.all(promises)),
	};

	beforeEach(async () => {
		jest.clearAllMocks();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ShippingService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<ShippingService>(ShippingService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('findAllZones', () => {
		it('should find only active zones with active neighborhoods by default', async () => {
			mockPrismaService.deliveryZone.findMany.mockResolvedValue([
				{
					id: 'zone-1',
					name: 'Dakar',
					price: 1500,
					isActive: true,
					neighborhoods: [{ id: 'n-1', name: 'Plateau', isActive: true }],
				},
			]);

			const result = await service.findAllZones(false);
			expect(result).toHaveLength(1);
			expect(mockPrismaService.deliveryZone.findMany).toHaveBeenCalledWith({
				where: { isActive: true },
				include: {
					neighborhoods: {
						where: { isActive: true },
						orderBy: { name: 'asc' },
					},
				},
				orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
			});
		});
	});

	describe('findAllNeighborhoods', () => {
		it('should find active neighborhoods with their zone', async () => {
			mockPrismaService.deliveryNeighborhood.findMany.mockResolvedValue([
				{
					id: 'n-1',
					name: 'Almadies',
					deliveryZone: { id: 'z-1', name: 'Dakar', price: 2000, isActive: true },
				},
			]);

			const result = await service.findAllNeighborhoods(false);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Almadies');
			expect(mockPrismaService.deliveryNeighborhood.findMany).toHaveBeenCalledWith({
				where: {
					isActive: true,
					deliveryZone: { isActive: true },
				},
				include: {
					deliveryZone: {
						select: {
							id: true,
							name: true,
							price: true,
							isActive: true,
						},
					},
				},
				orderBy: [{ name: 'asc' }],
			});
		});
	});

	describe('createNeighborhood', () => {
		it('should create a single neighborhood if zone exists', async () => {
			mockPrismaService.deliveryZone.findUnique.mockResolvedValue({
				id: 'z-1',
				name: 'Zone 1',
			});
			mockPrismaService.deliveryNeighborhood.create.mockResolvedValue({
				id: 'n-1',
				name: 'Mermoz',
				deliveryZoneId: 'z-1',
				isActive: true,
			});

			const result = await service.createNeighborhood({
				name: 'Mermoz',
				deliveryZoneId: 'z-1',
			});

			expect(result).toBeDefined();
			expect(result.name).toBe('Mermoz');
		});
	});
});
