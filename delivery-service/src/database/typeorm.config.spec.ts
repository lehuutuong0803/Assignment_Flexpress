import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDataSourceOptions } from './typeorm.config';

const base = {
  DB_HOST: 'db',
  DB_PORT: 5432,
  DB_NAME: 'delivery',
  DB_USER: 'delivery',
  DB_PASSWORD: 'secret',
};

describe('buildDataSourceOptions', () => {
  it('disables TLS when DB_SSL is false', () => {
    expect(buildDataSourceOptions({ ...base, DB_SSL: false })).toMatchObject({
      ssl: false,
      synchronize: false,
    });
  });

  it('verifies the server certificate against the given CA bundle', () => {
    const caFile = join(mkdtempSync(join(tmpdir(), 'ca-')), 'rds-ca.pem');
    writeFileSync(
      caFile,
      '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n',
    );
    const options = buildDataSourceOptions({
      ...base,
      DB_SSL: true,
      DB_SSL_CA: caFile,
    });
    const ssl = options.ssl as { rejectUnauthorized?: boolean; ca?: string };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain('BEGIN CERTIFICATE');
  });
});
