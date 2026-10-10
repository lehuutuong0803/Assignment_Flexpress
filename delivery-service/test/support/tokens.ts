import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  JWTPayload,
  JWTVerifyGetKey,
  SignJWT,
} from 'jose';

export const TEST_ISSUER = 'http://localhost:8080/realms/flexpress';
export const TEST_AUDIENCE = 'delivery-service';
export const COMPANY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const COMPANY_B = 'bbbbbbbb-0000-4000-8000-000000000002';

export interface TestKeys {
  /** JWKS containing only the trusted public key, as Keycloak would serve it. */
  jwks: JWTVerifyGetKey;
  /** Signs a token with the trusted key; claims and header fields can be overridden. */
  sign: (
    claims?: JWTPayload,
    opts?: { expiresIn?: string; issuer?: string; audience?: string },
  ) => Promise<string>;
  /** Signs with a different key that is NOT in the JWKS (forged token). */
  signWithUntrustedKey: (claims?: JWTPayload) => Promise<string>;
}

/** Real RS256 keys generated per test run: tokens are verified exactly as in production. */
export async function createTestKeys(): Promise<TestKeys> {
  const trusted = await generateKeyPair('RS256');
  const untrusted = await generateKeyPair('RS256');
  const publicJwk = {
    ...(await exportJWK(trusted.publicKey)),
    kid: 'test-key',
    alg: 'RS256',
  };

  const build = (
    claims: JWTPayload,
    issuer: string,
    audience: string,
    expiresIn: string,
  ) =>
    new SignJWT({
      realm_access: { roles: ['dispatcher'] },
      company_id: COMPANY_A,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(claims.sub ?? '1a000000-0000-4000-8000-000000000001')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn);

  return {
    jwks: createLocalJWKSet({ keys: [publicJwk] }),
    sign: (claims = {}, opts = {}) =>
      build(
        claims,
        opts.issuer ?? TEST_ISSUER,
        opts.audience ?? TEST_AUDIENCE,
        opts.expiresIn ?? '5m',
      ).sign(trusted.privateKey),
    signWithUntrustedKey: (claims = {}) =>
      build(claims, TEST_ISSUER, TEST_AUDIENCE, '5m').sign(
        untrusted.privateKey,
      ),
  };
}
