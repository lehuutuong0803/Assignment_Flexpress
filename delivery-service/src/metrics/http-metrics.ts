import type { NextFunction, Request, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * Prometheus metrics for HTTP traffic, in a registry of our own (not prom-client's global one), so
 * building the app twice (e.g. in tests) never fails with "metric already registered".
 */
export class HttpMetrics {
  readonly registry = new Registry();

  private readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route template and status code',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  private readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, by method, route template and status code',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    // CPU, memory, event-loop lag, GC: free and useful when investigating.
    collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Express middleware: runs before Nest guards, so 401/403 and unknown routes are counted too
   * (an interceptor would miss requests rejected by a guard).
   */
  readonly middleware = (req: Request, res: Response, next: NextFunction) => {
    // originalUrl, not path: under Nest's forRoutes() mount, req.path isn't the full path.
    if (req.originalUrl.split('?')[0] === '/metrics') {
      return next(); // scrapes would distort the traffic they measure
    }
    const stopTimer = this.duration.startTimer();
    res.on('finish', () => {
      const labels = {
        method: req.method,
        route: routeLabel(req),
        status_code: String(res.statusCode),
      };
      this.requests.inc(labels);
      stopTimer(labels);
    });
    next();
  };
}

/**
 * The route template ("/orders/:id"), never the raw URL: every distinct label value is a separate
 * time series, so raw ids would grow Prometheus without bound. Express sets `req.route` once a
 * route matched. Unknown paths (404s, scans) collapse into one value: they either match no route
 * or Nest's catch-all 404 route ("{/*splat}").
 */
export function routeLabel(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string' || path.includes('*')) {
    return 'unmatched';
  }
  return `${req.baseUrl}${path}`;
}
