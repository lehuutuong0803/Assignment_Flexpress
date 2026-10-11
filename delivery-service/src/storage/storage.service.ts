import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUpload {
  url: string;
  expiresInSeconds: number;
}

/**
 * Thin wrapper over the S3 API (works with MinIO and AWS S3).
 * Two clients on purpose: `internal` is what the service calls (HeadObject), `signer` signs URLs
 * with the endpoint clients actually reach, because the host is part of the signature.
 */
export class StorageService {
  constructor(
    private readonly internal: S3Client,
    private readonly signer: S3Client,
    private readonly bucket: string,
  ) {}

  /** A URL that allows exactly one PUT of `key` with this Content-Type, until it expires. */
  async presignPut(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: expiresInSeconds,
      // By default only `host` is signed. Signing Content-Type makes an upload with any other
      // type fail with 403, so the URL can't be used to store, say, an HTML file.
      signableHeaders: new Set(['content-type']),
    });
    return { url, expiresInSeconds };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) {
        return false;
      }
      throw error; // storage unreachable or misconfigured: surface as 500, don't pretend "missing"
    }
  }
}
