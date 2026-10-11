import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and the e2e tests, so tests run the same request pipeline as production. */
export function configureApp(app: INestApplication): void {
  // DTOs are the API contract: unknown fields are rejected (400), and query/body values are
  // transformed into DTO instances so @Type, @Transform and defaults apply.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

/** OpenAPI docs at /docs (JSON at /docs-json), with Bearer auth applied to every operation. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Flexpress delivery-service')
    .setDescription(
      'Delivery orders for dispatchers and drivers. Authenticate with a Keycloak access token.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
