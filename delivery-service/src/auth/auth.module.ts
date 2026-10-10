import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { EnvironmentVariables } from '../config/env.validation';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenVerifier } from './token-verifier';

@Module({
  providers: [
    {
      provide: TokenVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new TokenVerifier(
          // Fetches Keycloak's public keys (internal URL), caches them, and refetches when a
          // token carries an unknown `kid`, so key rotation needs no restart.
          createRemoteJWKSet(
            new URL(config.get('KEYCLOAK_JWKS_URI', { infer: true })),
          ),
          {
            issuer: config.get('KEYCLOAK_ISSUER', { infer: true }),
            audience: config.get('KEYCLOAK_AUDIENCE', { infer: true }),
          },
        ),
    },
    // Global guards run in registration order: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
