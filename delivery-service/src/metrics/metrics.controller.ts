import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { HttpMetrics } from './http-metrics';

/**
 * Prometheus scrape endpoint. Public because Prometheus has no token; in production nginx
 * blocks /metrics from the internet so only the private network can scrape it.
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: HttpMetrics) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
