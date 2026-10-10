// Entry point for the TypeORM CLI (migration:run / generate / revert). It runs outside Nest, so
// ConfigModule doesn't load .env here. Load it if present (real env vars still take precedence)
// and validate with the same rules as the app.
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './typeorm.config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default new DataSource(buildDataSourceOptions(validateEnv(process.env)));
