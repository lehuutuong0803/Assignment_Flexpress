import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { EnvironmentVariables } from '../config/env.validation';

export const REQUEST_ID_HEADER = 'x-request-id';

// The header comes from the client, so it's untrusted: bound its length and charset to prevent
// log injection (newlines, huge values). Anything else gets a fresh id.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// Probes hit these every few seconds; logging each call would drown real traffic.
const QUIET_PATHS = new Set(['/health', '/health/ready', '/metrics']);

export function requestIdFor(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * JSON logs via pino. Every line logged while handling a request carries `req.id`
 * (nestjs-pino keeps the request logger in AsyncLocalStorage), and one summary line is written
 * per request with status and duration.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // "level":"warn" and ISO timestamps instead of pino's numeric defaults (40, epoch ms):
          // readable for humans and recognised by Loki, Datadog, CloudWatch without mapping.
          formatters: { level: (label: string) => ({ level: label }) },
          timestamp: stdTimeFunctions.isoTime,
          genReqId: requestIdFor,
          // Log only what's useful; never headers, so tokens and cookies can't leak into logs.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          // Second line of defence in case a header object is ever logged explicitly.
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          customLogLevel: (_req, res, err) =>
            err || res.statusCode >= 500
              ? 'error'
              : res.statusCode >= 400
                ? 'warn'
                : 'info',
          autoLogging: {
            ignore: (req) => QUIET_PATHS.has((req.url ?? '').split('?')[0]),
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
