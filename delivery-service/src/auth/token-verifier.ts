import { ForbiddenException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JWTPayload, JWTVerifyGetKey, jwtVerify } from 'jose';
import { AuthUser, Role } from './auth-user';

export interface TokenVerifierOptions {
  /** Must equal the token's `iss` exactly (the public Keycloak URL). */
  issuer: string;
  /** Must be contained in the token's `aud`. */
  audience: string;
}

const knownRoles = new Set<string>(Object.values(Role));

/**
 * Verifies a Keycloak access token and turns it into an AuthUser.
 * Throws a jose error for an invalid token (signature, issuer, audience, expiry) and a
 * ForbiddenException for a valid token that can't be used here (no company or no single role).
 */
export class TokenVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly options: TokenVerifierOptions,
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      // Pin the algorithm: never accept `none` or a different algorithm chosen by the token.
      algorithms: ['RS256'],
      clockTolerance: 5,
    });
    return toAuthUser(payload);
  }
}

function toAuthUser(payload: JWTPayload): AuthUser {
  const companyId = payload.company_id;
  // The DB column is uuid: reject anything else here instead of failing with a 500 later.
  if (typeof companyId !== 'string' || !isUUID(companyId)) {
    throw new ForbiddenException('Token has no valid company_id');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new ForbiddenException('Token has no subject');
  }

  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  const tokenRoles = Array.isArray(realmAccess?.roles) ? realmAccess.roles : [];
  const roles = tokenRoles.filter(
    (r): r is Role => typeof r === 'string' && knownRoles.has(r),
  );
  // Each user has exactly one delivery role; anything else is ambiguous, so deny.
  if (roles.length !== 1) {
    throw new ForbiddenException(
      'Token must have exactly one role: dispatcher or driver',
    );
  }

  return { sub: payload.sub, companyId, role: roles[0] };
}
