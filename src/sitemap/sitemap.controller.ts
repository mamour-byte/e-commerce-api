import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SitemapService } from './sitemap.service';

@Controller()
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60')
  async getSitemap(@Res() res: Response) {
    const xml = await this.sitemapService.generateXml();
    res.send(xml);
  }
}