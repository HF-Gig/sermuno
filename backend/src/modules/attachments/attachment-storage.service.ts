import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'attachment-storage');

export type AttachmentStorageMetadata = {
  contentType: string | null;
  sizeBytes: number;
};

@Injectable()
export class AttachmentStorageService {
  private readonly logger = new Logger(AttachmentStorageService.name);
  private readonly storageType: string;
  private readonly bucket: string;
  private readonly maxDirectBytes: number;
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    this.storageType = config.get<string>('attachment.storageType') ?? 'local';
    this.bucket = config.get<string>('attachment.s3Bucket') ?? '';
    this.maxDirectBytes =
      config.get<number>('attachment.maxDirectBytes') ?? 10_485_760;

    if (this.storageType === 's3') {
      this.s3 = new S3Client({
        region: config.get<string>('attachment.s3Region') ?? 'us-east-1',
        endpoint: config.get<string>('attachment.s3Endpoint') || undefined,
        credentials: {
          accessKeyId: config.get<string>('attachment.s3AccessKey') ?? '',
          secretAccessKey: config.get<string>('attachment.s3SecretKey') ?? '',
        },
        forcePathStyle: !!config.get<string>('attachment.s3Endpoint'),
      });
    } else {
      this.s3 = null;
      if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
        fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
      }
    }
  }

  /** Whether the given file size requires a pre-signed upload URL */
  requiresPresign(sizeBytes: number): boolean {
    return this.storageType === 's3' && sizeBytes > this.maxDirectBytes;
  }

  isS3Storage(): boolean {
    return this.storageType === 's3' && !!this.s3;
  }

  /** Generate a unique storage key for a new attachment */
  generateStorageKey(organizationId: string, filename: string): string {
    const id = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(filename);
    return `${organizationId}/${id}${ext}`;
  }

  generateQuarantineKey(organizationId: string, filename: string): string {
    const id = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(filename);
    return `${organizationId}/quarantine/${id}${ext}`;
  }

  generateStagingKey(organizationId: string, filename: string): string {
    const id = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(filename);
    return `${organizationId}/incoming/${id}${ext}`;
  }

  /**
   * Upload a file buffer directly (for small files).
   * Returns the storageKey.
   */
  async upload(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (this.storageType === 's3' && this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    } else {
      const filePath = path.join(
        LOCAL_STORAGE_DIR,
        storageKey.replace(/\//g, '_'),
      );
      fs.writeFileSync(filePath, buffer);
    }
    return storageKey;
  }

  /**
   * Generate a pre-signed PUT URL for large S3 uploads.
   * Client uploads directly to S3, then calls confirmUpload.
   */
  async presignedPutUrl(
    storageKey: string,
    contentType: string,
    expiresIn = 3600,
  ): Promise<string> {
    if (!this.s3) {
      throw new Error('Pre-signed URLs only supported for S3 storage');
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Generate a pre-signed GET URL for download.
   */
  async presignedGetUrl(storageKey: string, expiresIn = 3600): Promise<string> {
    if (this.storageType === 's3' && this.s3) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });
      return getSignedUrl(this.s3, command, { expiresIn });
    }
    // For local storage return a relative download path
    return `/attachments/local/${encodeURIComponent(storageKey)}`;
  }

  /**
   * Stream a locally-stored file as a Buffer (for local storage downloads).
   */
  async getLocalBuffer(storageKey: string): Promise<Buffer> {
    const filePath = path.join(
      LOCAL_STORAGE_DIR,
      storageKey.replace(/\//g, '_'),
    );
    return fs.promises.readFile(filePath);
  }

  async getReadStream(storageKey: string): Promise<Readable> {
    if (this.storageType === 's3' && this.s3) {
      return this.getS3Stream(storageKey);
    }

    const filePath = path.join(
      LOCAL_STORAGE_DIR,
      storageKey.replace(/\//g, '_'),
    );
    return fs.createReadStream(filePath);
  }

  async getMetadata(storageKey: string): Promise<AttachmentStorageMetadata> {
    if (this.storageType === 's3' && this.s3) {
      const response = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );

      return {
        contentType: response.ContentType ?? null,
        sizeBytes: Number(response.ContentLength ?? 0),
      };
    }

    const filePath = path.join(
      LOCAL_STORAGE_DIR,
      storageKey.replace(/\//g, '_'),
    );
    const stat = await fs.promises.stat(filePath);

    return {
      contentType: null,
      sizeBytes: Number(stat.size),
    };
  }

  /**
   * Stream a file from S3.
   */
  async getS3Stream(storageKey: string): Promise<Readable> {
    if (!this.s3) throw new Error('S3 not configured');
    const resp = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    return resp.Body as Readable;
  }

  /**
   * Delete a file from storage by storageKey.
   */
  async delete(storageKey: string): Promise<void> {
    if (this.storageType === 's3' && this.s3) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      );
    } else {
      const filePath = path.join(
        LOCAL_STORAGE_DIR,
        storageKey.replace(/\//g, '_'),
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    this.logger.log(`[storage] deleted storageKey=${storageKey}`);
  }

  async move(sourceKey: string, targetKey: string): Promise<string> {
    if (sourceKey === targetKey) {
      return targetKey;
    }

    if (this.storageType === 's3' && this.s3) {
      const copySource = `${this.bucket}/${sourceKey
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`;

      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: copySource,
          Key: targetKey,
        }),
      );

      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: sourceKey }),
      );
      return targetKey;
    }

    const sourcePath = path.join(
      LOCAL_STORAGE_DIR,
      sourceKey.replace(/\//g, '_'),
    );
    const targetPath = path.join(
      LOCAL_STORAGE_DIR,
      targetKey.replace(/\//g, '_'),
    );

    if (fs.existsSync(sourcePath)) {
      await fs.promises.rename(sourcePath, targetPath);
    }

    return targetKey;
  }
}
