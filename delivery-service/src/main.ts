import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';

async function bootstrap() {
  // Buffer startup logs until the pino logger is ready, so every line is JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // On SIGTERM (docker stop, blue/green switch): stop accepting connections, let in-flight requests
  // finish, close the DB pool, then exit 0. Without it Node as PID 1 ignores SIGTERM and Docker
  // has to SIGKILL it after 10 s (exit 137), cutting requests and DB connections mid-flight.
  app.enableShutdownHooks();
  configureApp(app);
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
