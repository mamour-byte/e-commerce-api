import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from './stats.service';

describe('StatsService', () => {
  let service: StatsService;

  const mockPrismaService = {
    order: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    orderItem: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    product: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    productVariant: {
      findMany: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StatsService>(StatsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns sales stats with totals, timeline, and top products', async () => {
    mockPrismaService.order.aggregate.mockResolvedValue({
      _sum: {
        total: 150,
        subtotal: 160,
        discountAmount: 10,
        shippingAmount: 0,
        taxAmount: 0,
      },
    });
    mockPrismaService.order.count.mockResolvedValue(2);
    mockPrismaService.orderItem.aggregate.mockResolvedValue({
      _sum: { quantity: 5, total: 150 },
    });
    mockPrismaService.orderItem.groupBy.mockResolvedValue([
      { productId: 'product-1', _sum: { quantity: 5, total: 150 } },
    ]);
    mockPrismaService.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Produit test',
        slug: 'produit-test',
        sku: 'SKU-1',
        price: 30,
        quantity: 20,
        images: [{ url: 'https://example.com/product.jpg' }],
      },
    ]);
    mockPrismaService.order.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        total: 60,
        items: [{ quantity: 2 }],
      },
      {
        createdAt: new Date('2026-08-02T10:00:00.000Z'),
        total: 90,
        items: [{ quantity: 3 }],
      },
    ]);

    const result = await service.getSales({
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      limit: 5,
    });

    expect(result.summary).toEqual({
      revenue: 150,
      subtotal: 160,
      discountAmount: 10,
      shippingAmount: 0,
      taxAmount: 0,
      orders: 2,
      unitsSold: 5,
      itemsRevenue: 150,
      averageOrderValue: 75,
    });
    expect(result.timeline).toHaveLength(2);
    expect(result.topProducts).toEqual([
      expect.objectContaining({
        productId: 'product-1',
        quantitySold: 5,
        revenue: 150,
      }),
    ]);
  });

  it('rejects inverted date ranges', async () => {
    await expect(
      service.getSales({
        startDate: '2026-08-10',
        endDate: '2026-08-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies the selected date range to dashboard customer and order metrics', async () => {
    mockPrismaService.order.aggregate.mockResolvedValue({ _sum: {} });
    mockPrismaService.order.count.mockResolvedValue(0);
    mockPrismaService.order.findMany.mockResolvedValue([]);
    mockPrismaService.orderItem.aggregate.mockResolvedValue({ _sum: {} });
    mockPrismaService.orderItem.groupBy.mockResolvedValue([]);
    mockPrismaService.order.groupBy.mockResolvedValue([]);
    mockPrismaService.product.count.mockResolvedValue(0);
    mockPrismaService.product.findMany.mockResolvedValue([]);
    mockPrismaService.productVariant.findMany.mockResolvedValue([]);
    mockPrismaService.user.count.mockResolvedValue(0);

    await service.getDashboard({
      startDate: '2026-08-01',
      endDate: '2026-08-02',
    });

    const range = {
      gte: new Date('2026-08-01T00:00:00.000Z'),
      lte: new Date('2026-08-02T23:59:59.999Z'),
    };

    expect(mockPrismaService.user.count).toHaveBeenCalledWith({
      where: { role: 'CUSTOMER', createdAt: range },
    });
    expect(mockPrismaService.order.count).toHaveBeenCalledWith({
      where: { status: 'PENDING', createdAt: range },
    });
    expect(mockPrismaService.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: range },
        select: expect.objectContaining({
          fulfillmentType: true,
          deliveryZoneId: true,
          shippingAmount: true,
        }),
      }),
    );
  });

  it('includes the delivery amount in recent dashboard orders', async () => {
    mockPrismaService.order.aggregate.mockResolvedValue({ _sum: {} });
    mockPrismaService.order.count.mockResolvedValue(0);
    mockPrismaService.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNumber: 'CMD-1',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        fulfillmentType: 'DELIVERY',
        deliveryZoneId: 'zone-1',
        shippingAmount: 2500,
        total: 12500,
        currency: 'XOF',
        customerEmail: 'client@example.com',
        customerPhone: '770000000',
        createdAt: new Date('2026-08-28T10:00:00.000Z'),
        items: [],
      },
    ]);
    mockPrismaService.orderItem.aggregate.mockResolvedValue({ _sum: {} });
    mockPrismaService.orderItem.groupBy.mockResolvedValue([]);
    mockPrismaService.order.groupBy.mockResolvedValue([]);
    mockPrismaService.product.count.mockResolvedValue(0);
    mockPrismaService.product.findMany.mockResolvedValue([]);
    mockPrismaService.productVariant.findMany.mockResolvedValue([]);
    mockPrismaService.user.count.mockResolvedValue(0);

    const result = await service.getDashboard({});

    expect(result.recentOrders[0]).toEqual(
      expect.objectContaining({
        fulfillmentType: 'DELIVERY',
        deliveryZoneId: 'zone-1',
        shippingAmount: 2500,
        total: 12500,
      }),
    );
  });
});
