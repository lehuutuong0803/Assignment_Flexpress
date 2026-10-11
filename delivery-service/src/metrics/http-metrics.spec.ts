import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { HttpMetrics, routeLabel } from './http-metrics';

function fakeRequest(path: string, routePath?: string): Request {
  return {
    method: 'GET',
    path,
    originalUrl: path,
    baseUrl: '',
    route: routePath ? { path: routePath } : undefined,
  } as unknown as Request;
}

function run(metrics: HttpMetrics, req: Request, statusCode: number) {
  const res = Object.assign(new EventEmitter(), { statusCode });
  const next: NextFunction = jest.fn();
  metrics.middleware(req, res as unknown as Response, next);
  res.emit('finish');
  return next;
}

describe('routeLabel', () => {
  it('uses the route template, not the raw URL', () => {
    expect(routeLabel(fakeRequest('/orders/123', '/orders/:id'))).toBe(
      '/orders/:id',
    );
  });

  it('collapses unmatched paths into one value', () => {
    expect(routeLabel(fakeRequest('/wp-admin.php'))).toBe('unmatched');
  });

  it("treats Nest's catch-all 404 route as unmatched", () => {
    expect(routeLabel(fakeRequest('/wp-admin.php', '{/*splat}'))).toBe(
      'unmatched',
    );
  });
});

describe('HttpMetrics', () => {
  it('counts requests and records latency by method, route and status', async () => {
    const metrics = new HttpMetrics();
    run(metrics, fakeRequest('/orders/1', '/orders/:id'), 200);
    run(metrics, fakeRequest('/orders/2', '/orders/:id'), 200);
    run(metrics, fakeRequest('/orders'), 401);

    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/orders/:id",status_code="200"} 2',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="unmatched",status_code="401"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="200"} 2',
    );
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('does not measure the scrape endpoint itself', async () => {
    const metrics = new HttpMetrics();
    // Under Nest's middleware mount req.path is not the full path; originalUrl is.
    const req = {
      ...fakeRequest('/metrics', '/metrics'),
      path: '/',
    } as Request;
    req.originalUrl = '/metrics?x=1';
    const next = run(metrics, req, 200);
    expect(next).toHaveBeenCalled();
    expect(await metrics.registry.metrics()).not.toContain('route="/metrics"');
  });
});
