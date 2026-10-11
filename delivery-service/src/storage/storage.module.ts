import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { StorageService } from './storage.service';

@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', {
          infer: true,
        });
        const endpoint = config.get('S3_ENDPOINT', { infer: true });
        const base: S3ClientConfig = {
          region: config.get('S3_REGION', { infer: true }),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          // Without explicit keys the SDK default chain is used (env, IAM role, ...).
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
          // Newer SDKs add CRC checksums to every PUT by default; a presigned browser/mobile
          // upload can't compute them, so only send checksums when the operation requires one.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        };
        const internal = new S3Client({ ...base, endpoint });
        const signer = new S3Client({
          ...base,
          endpoint:
            config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint,
        });
        return new StorageService(
          internal,
          signer,
          config.get('S3_BUCKET', { infer: true }),
        );
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
