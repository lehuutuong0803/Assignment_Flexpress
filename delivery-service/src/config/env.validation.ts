// Implicit type conversion reads emitted type metadata; import it here so this module also works
// outside Nest (unit tests, the TypeORM CLI).
import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

// Env values are always strings, and Boolean('false') === true. Implicit conversion runs before
// @Transform, so read the raw value from `obj` instead of the already-converted `value`.
const toBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => {
  const raw = obj[key];
  return raw === 'true' ? true : raw === 'false' ? false : raw;
};

const url = { require_tld: false, protocols: ['http', 'https'] };

/**
 * Every setting the service needs. Validated once at startup: a missing or malformed value
 * stops the process with a clear error instead of failing later at runtime.
 * Only non-secret settings have defaults; credentials must always be provided.
 */
export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_SSL: boolean = false;

  /**
   * Path to a CA bundle for the database's TLS certificate (e.g. the Amazon RDS bundle). Node's
   * default trust store doesn't include the RDS CA, so certificate verification needs it.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  DB_SSL_CA?: string;

  /** Public issuer, exactly as it appears in the token's `iss` claim. */
  @IsUrl(url)
  KEYCLOAK_ISSUER!: string;

  /** Where the service fetches signing keys; may be an internal URL (e.g. http://keycloak:8080). */
  @IsUrl(url)
  KEYCLOAK_JWKS_URI!: string;

  @IsString()
  @IsNotEmpty()
  KEYCLOAK_AUDIENCE!: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  S3_REGION: string = 'us-east-1';

  /** Endpoint the service itself calls (e.g. http://minio:9000). Empty = AWS S3. */
  @IsOptional()
  @IsUrl(url)
  S3_ENDPOINT?: string;

  /**
   * Endpoint used to sign presigned URLs, as clients outside Docker reach it (e.g.
   * http://localhost:9000, or via nginx in production). The host is part of the signature.
   * Empty = same as S3_ENDPOINT.
   */
  @IsOptional()
  @IsUrl(url)
  S3_PUBLIC_ENDPOINT?: string;

  /** MinIO needs path-style URLs (host/bucket/key); AWS S3 uses virtual-hosted style. */
  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE: boolean = false;

  /** Optional: without them the AWS SDK default chain is used (e.g. an IAM role). */
  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return env;
}
