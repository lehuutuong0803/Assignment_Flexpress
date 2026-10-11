import { validateEnv } from './env.validation';

const valid = {
  DB_HOST: 'localhost',
  DB_NAME: 'delivery',
  DB_USER: 'delivery',
  DB_PASSWORD: 'secret',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/flexpress',
  KEYCLOAK_JWKS_URI:
    'http://keycloak:8080/realms/flexpress/protocol/openid-connect/certs',
  KEYCLOAK_AUDIENCE: 'delivery-service',
  S3_BUCKET: 'flexpress-pod',
};

describe('validateEnv', () => {
  it('accepts a valid configuration and applies non-secret defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(5432);
    expect(env.DB_SSL).toBe(false);
  });

  it('converts numeric strings to numbers', () => {
    expect(validateEnv({ ...valid, DB_PORT: '6543' }).DB_PORT).toBe(6543);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('parses DB_SSL=%s as %s', (raw, expected) => {
    expect(validateEnv({ ...valid, DB_SSL: raw }).DB_SSL).toBe(expected);
  });

  it('rejects a missing secret', () => {
    const withoutPassword: Record<string, unknown> = { ...valid };
    delete withoutPassword.DB_PASSWORD;
    expect(() => validateEnv(withoutPassword)).toThrow(/DB_PASSWORD/);
  });

  it('rejects a malformed URL', () => {
    expect(() =>
      validateEnv({ ...valid, KEYCLOAK_ISSUER: 'not a url' }),
    ).toThrow(/KEYCLOAK_ISSUER/);
  });
});
