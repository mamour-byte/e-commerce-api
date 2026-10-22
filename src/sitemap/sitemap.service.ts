import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductStatus } from '@prisma/client';

const BASE_URL = 'https://www.hayat-sn.store';

function toISODate(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString().split('T')[0];
}

@Injectable()
export class SitemapService {
  constructor(private readonly prisma: PrismaService) {}

  async generateXml(): Promise<string> {
    const products = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
      select: { slug: true, updatedAt: true, createdAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    const urls: string[] = [];

    urls.push(
      '  <url>\n' +
        `    <loc>${BASE_URL}/</loc>\n` +
        '    <changefreq>daily</changefreq>\n' +
        '    <priority>1.0</priority>\n' +
        '  </url>',
      '  <url>\n' +
        `    <loc>${BASE_URL}/products</loc>\n` +
        '    <changefreq>daily</changefreq>\n' +
        '    <priority>0.9</priority>\n' +
        '  </url>',
      '  <url>\n' +
        `    <loc>${BASE_URL}/contact</loc>\n` +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.4</priority>\n' +
        '  </url>',
    );

    for (const prod of products) {
      const lastmod = toISODate(prod.updatedAt ?? prod.createdAt);
      let url =
        '  <url>\n' +
        `    <loc>${BASE_URL}/products/${encodeURIComponent(prod.slug)}</loc>\n`;
      if (lastmod) {
        url += `    <lastmod>${lastmod}</lastmod>\n`;
      }
      url +=
        '    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>';
      urls.push(url);
    }

    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n'
    );
  }
}
