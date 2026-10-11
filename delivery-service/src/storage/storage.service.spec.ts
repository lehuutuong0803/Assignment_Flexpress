import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

describe('StorageService.presignPut', () => {
  // Signing is local: no network call is made.
  const client = (endpoint: string) =>
    new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  const service = new StorageService(
    client('http://minio:9000'),
    client('http://localhost:9000'),
    'flexpress-pod',
  );

  it('signs with the public endpoint, not the internal one', async () => {
    const { url } = await service.presignPut(
      'orders/1/pod/a.jpg',
      'image/jpeg',
      300,
    );
    expect(new URL(url).host).toBe('localhost:9000');
  });

  it('signs the Content-Type, so another type is rejected by storage', async () => {
    const { url } = await service.presignPut(
      'orders/1/pod/a.jpg',
      'image/jpeg',
      300,
    );
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
  });

  it('expires after the requested time', async () => {
    const { url, expiresInSeconds } = await service.presignPut(
      'k',
      'image/png',
      300,
    );
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(expiresInSeconds).toBe(300);
  });
});
