import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { IdempotencyKey } from '../orders/idempotency-key.entity';
import { OrderStatusEvent } from '../orders/order-status-event.entity';
import { Order } from '../orders/order.entity';

type DbEnv = Pick<
  EnvironmentVariables,
  'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASSWORD' | 'DB_SSL'
>;

// Under ts-node (dev CLI) migrations are .ts; in the compiled app they are .js. Matching only the
// current extension also skips the .d.ts files emitted next to them.
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

/** Shared by the Nest app and the TypeORM CLI, so both always use the same settings. */
export function buildDataSourceOptions(env: DbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
    entities: [Order, OrderStatusEvent, IdempotencyKey],
    migrations: [join(__dirname, 'migrations', `*.${ext}`)],
    migrationsTableName: 'migrations',
    // Schema changes only through reviewed migrations, run as a separate step before the app starts.
    synchronize: false,
    migrationsRun: false,
    // gen_random_uuid() is built into PostgreSQL 13+; never run CREATE EXTENSION at runtime.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}
