import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProductStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatsQueryDto } from './dto/stats-query.dto';

type DateRange = {
  startDate: Date;
  endDate: Date;
  where: Prisma.DateTimeFilter;
};

const SALE_ORDER_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.IN_DELIVERY,
  OrderStatus.DELIVERED,
];

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: StatsQueryDto) {
    const range = this.resolveDateRange(query);

    const [
      sales,
      products,
      totalCustomers,
      pendingOrders,
      recentOrders,
      ordersByStatus,
      paymentsByStatus,
    ] = await Promise.all([
      this.getSales(query),
      this.getProducts(query),
      this.prisma.user.count({
        where: { role: UserRole.CUSTOMER, createdAt: range.where },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.PENDING, createdAt: range.where },
      }),
      this.prisma.order.findMany({
        where: { createdAt: range.where },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          fulfillmentType: true,
          deliveryZoneId: true,
          shippingAmount: true,
          total: true,
          currency: true,
          customerEmail: true,
          customerPhone: true,
          createdAt: true,
        },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: range.where },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['paymentStatus'],
        where: { createdAt: range.where },
        _count: { _all: true },
      }),
    ]);

    return {
      range: this.formatRange(range),
      overview: {
        revenue: sales.summary.revenue,
        orders: sales.summary.orders,
        averageOrderValue: sales.summary.averageOrderValue,
        unitsSold: sales.summary.unitsSold,
        customers: totalCustomers,
        products: products.summary.total,
        activeProducts: products.summary.active,
        lowStockProducts: products.summary.lowStock,
        outOfStockProducts: products.summary.outOfStock,
        pendingOrders,
      },
      sales: {
        timeline: sales.timeline,
        topProducts: sales.topProducts,
      },
      products: {
        stockAlerts: products.stockAlerts,
        topProducts: products.topProducts,
      },
      ordersByStatus: ordersByStatus.map((item) => ({
        status: item.status,
        count: item._count._all,
      })),
      paymentsByStatus: paymentsByStatus.map((item) => ({
        status: item.paymentStatus,
        count: item._count._all,
      })),
      recentOrders: recentOrders.map((order) => ({
        ...order,
        shippingAmount: Number(order.shippingAmount),
        total: Number(order.total),
      })),
    };
  }

  async getSales(query: StatsQueryDto) {
    const range = this.resolveDateRange(query);
    const limit = query.limit || 10;
    const orderWhere = this.buildSalesOrderWhere(range);

    const [
      ordersAggregate,
      ordersCount,
      itemsAggregate,
      topProducts,
      timeline,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: orderWhere,
        _sum: {
          total: true,
          subtotal: true,
          discountAmount: true,
          shippingAmount: true,
          taxAmount: true,
        },
      }),
      this.prisma.order.count({ where: orderWhere }),
      this.prisma.orderItem.aggregate({
        where: { order: orderWhere },
        _sum: {
          quantity: true,
          total: true,
        },
      }),
      this.getTopProducts(orderWhere, limit),
      this.getSalesTimeline(orderWhere),
    ]);

    const revenue = Number(ordersAggregate._sum.total || 0);

    return {
      range: this.formatRange(range),
      summary: {
        revenue,
        subtotal: Number(ordersAggregate._sum.subtotal || 0),
        discountAmount: Number(ordersAggregate._sum.discountAmount || 0),
        shippingAmount: Number(ordersAggregate._sum.shippingAmount || 0),
        taxAmount: Number(ordersAggregate._sum.taxAmount || 0),
        orders: ordersCount,
        unitsSold: itemsAggregate._sum.quantity || 0,
        itemsRevenue: Number(itemsAggregate._sum.total || 0),
        averageOrderValue: ordersCount ? revenue / ordersCount : 0,
      },
      timeline,
      topProducts,
    };
  }

  async getProducts(query: StatsQueryDto) {
    const range = this.resolveDateRange(query);
    const limit = query.limit || 10;
    const orderWhere = this.buildSalesOrderWhere(range);

    const [total, active, draft, archived, products, variants, topProducts] =
      await Promise.all([
        this.prisma.product.count(),
        this.prisma.product.count({ where: { status: ProductStatus.ACTIVE } }),
        this.prisma.product.count({ where: { status: ProductStatus.DRAFT } }),
        this.prisma.product.count({
          where: { status: ProductStatus.ARCHIVED },
        }),
        this.prisma.product.findMany({
          where: { status: { not: ProductStatus.ARCHIVED } },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            costPrice: true,
            quantity: true,
            trackInventory: true,
            status: true,
            images: {
              where: { isPrimary: true },
              orderBy: { position: 'asc' },
              take: 1,
              select: { url: true },
            },
          },
        }),
        this.prisma.productVariant.findMany({
          where: { isActive: true },
          select: {
            id: true,
            productId: true,
            name: true,
            sku: true,
            price: true,
            quantity: true,
          },
        }),
        this.getTopProducts(orderWhere, limit),
      ]);

    const LOW_STOCK_THRESHOLD = 5;

    const allStockAlerts = products
      .map((product) => {
        const quantity = product.quantity;
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          status: product.status,
          imageUrl: product.images[0]?.url || null,
          quantity,
          trackInventory: product.trackInventory,
        };
      })
      .filter(
        (product) =>
          product.trackInventory && product.quantity <= LOW_STOCK_THRESHOLD,
      )
      .sort((a, b) => a.quantity - b.quantity);

    const stockAlerts = allStockAlerts.slice(0, limit);

    const productStockValue = products.reduce((sum, product) => {
      const unitValue = Number(product.costPrice || product.price || 0);
      return sum + unitValue * product.quantity;
    }, 0);

    const variantStockValue = variants.reduce((sum, variant) => {
      const unitValue = Number(variant.price || 0);
      return sum + unitValue * variant.quantity;
    }, 0);

    return {
      range: this.formatRange(range),
      summary: {
        total,
        active,
        draft,
        archived,
        withVariants: variants.length,
        lowStock: allStockAlerts.length,
        outOfStock: products.filter(
          (product) => product.trackInventory && product.quantity <= 0,
        ).length,
        stockUnits: products.reduce((sum, product) => sum + product.quantity, 0),
        variantStockUnits: variants.reduce(
          (sum, variant) => sum + variant.quantity,
          0,
        ),
        stockValue: productStockValue + variantStockValue,
      },
      stockAlerts,
      topProducts,
    };
  }

  private resolveDateRange(query: StatsQueryDto): DateRange {
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);

    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Les dates fournies sont invalides.');
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'La date de debut doit etre inferieure ou egale a la date de fin.',
      );
    }

    return {
      startDate,
      endDate,
      where: {
        gte: startDate,
        lte: endDate,
      },
    };
  }

  private buildSalesOrderWhere(range: DateRange): Prisma.OrderWhereInput {
    return {
      createdAt: range.where,
      status: { in: SALE_ORDER_STATUSES },
      paymentStatus: PaymentStatus.PAID,
    };
  }

  private async getTopProducts(
    orderWhere: Prisma.OrderWhereInput,
    limit: number,
  ) {
    const groups = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: orderWhere },
      _sum: {
        quantity: true,
        total: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: limit,
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: groups.map((group) => group.productId) } },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        price: true,
        quantity: true,
        images: {
          where: { isPrimary: true },
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true },
        },
      },
    });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    return groups.map((group) => {
      const product = productById.get(group.productId);
      return {
        productId: group.productId,
        name: product?.name || null,
        slug: product?.slug || null,
        sku: product?.sku || null,
        imageUrl: product?.images[0]?.url || null,
        price: product ? Number(product.price) : 0,
        quantity: product?.quantity || 0,
        quantitySold: group._sum.quantity || 0,
        revenue: Number(group._sum.total || 0),
      };
    });
  }

  private async getSalesTimeline(orderWhere: Prisma.OrderWhereInput) {
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        total: true,
        items: {
          select: { quantity: true },
        },
      },
    });

    const timelineByDay = new Map<
      string,
      { date: string; revenue: number; orders: number; unitsSold: number }
    >();

    for (const order of orders) {
      const date = order.createdAt.toISOString().slice(0, 10);
      const current =
        timelineByDay.get(date) ||
        ({ date, revenue: 0, orders: 0, unitsSold: 0 } as const);

      timelineByDay.set(date, {
        date,
        revenue: current.revenue + Number(order.total),
        orders: current.orders + 1,
        unitsSold:
          current.unitsSold +
          order.items.reduce((sum, item) => sum + item.quantity, 0),
      });
    }

    return Array.from(timelineByDay.values());
  }

  private formatRange(range: DateRange) {
    return {
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
    };
  }
}
