import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpMetrics } from './http-metrics';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [MetricsController],
  providers: [{ provide: HttpMetrics, useFactory: () => new HttpMetrics() }],
})
export class MetricsModule implements NestModule {
  constructor(private readonly metrics: HttpMetrics) {}

  /** Nest calls this at startup: measure every route, including ones no controller matches. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(this.metrics.middleware).forRoutes('{*path}');
  }
}
