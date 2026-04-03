import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { Readable } from 'stream';

export type AttachmentVirusScanResult =
  | {
      status: 'clean';
      scannerName: string;
      scannerVersion: string | null;
      scannedAt: Date;
      rawResponse: string;
    }
  | {
      status: 'infected';
      scannerName: string;
      scannerVersion: string | null;
      scannedAt: Date;
      rawResponse: string;
      malwareSignature: string;
    }
  | {
      status: 'failed';
      scannerName: string;
      scannerVersion: string | null;
      scannedAt: Date;
      failureReason: string;
    };

@Injectable()
export class AttachmentVirusScannerService {
  private readonly logger = new Logger(AttachmentVirusScannerService.name);
  private readonly enabled: boolean;
  private readonly provider: string;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly scanOnDownload: boolean;
  private versionPromise: Promise<string | null> | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>('attachment.scan.enabled') ?? false;
    this.provider = config.get<string>('attachment.scan.provider') ?? 'clamav';
    this.host = config.get<string>('attachment.scan.clamavHost') ?? '127.0.0.1';
    this.port = config.get<number>('attachment.scan.clamavPort') ?? 3310;
    this.timeoutMs = config.get<number>('attachment.scan.timeoutMs') ?? 15_000;
    this.scanOnDownload =
      config.get<boolean>('attachment.scan.onDownload') ?? false;
  }

  isEnabled(): boolean {
    return this.enabled && this.provider === 'clamav';
  }

  shouldScanOnDownload(): boolean {
    return this.isEnabled() && this.scanOnDownload;
  }

  getScannerName(): string {
    return this.provider;
  }

  async scanBuffer(buffer: Buffer): Promise<AttachmentVirusScanResult> {
    return this.scanStream(Readable.from(buffer));
  }

  async scanStream(stream: Readable): Promise<AttachmentVirusScanResult> {
    if (!this.isEnabled()) {
      return {
        status: 'failed',
        scannerName: this.getScannerName(),
        scannerVersion: null,
        scannedAt: new Date(),
        failureReason: 'Attachment scanning is disabled',
      };
    }

    const scannedAt = new Date();

    try {
      const [rawResponse, scannerVersion] = await Promise.all([
        this.sendInstream(stream),
        this.getScannerVersion(),
      ]);

      if (/\bFOUND\b/i.test(rawResponse)) {
        const malwareSignature =
          rawResponse.match(/:\s*(.+?)\s+FOUND/i)?.[1]?.trim() ??
          'unknown-signature';

        return {
          status: 'infected',
          scannerName: this.getScannerName(),
          scannerVersion,
          scannedAt,
          rawResponse,
          malwareSignature,
        };
      }

      if (/\bOK\b/i.test(rawResponse)) {
        return {
          status: 'clean',
          scannerName: this.getScannerName(),
          scannerVersion,
          scannedAt,
          rawResponse,
        };
      }

      return {
        status: 'failed',
        scannerName: this.getScannerName(),
        scannerVersion,
        scannedAt,
        failureReason: rawResponse,
      };
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : 'Unknown scan error';
      this.logger.error(
        `[attachment-scan] ClamAV request failed: ${failureReason}`,
      );

      return {
        status: 'failed',
        scannerName: this.getScannerName(),
        scannerVersion: await this.getScannerVersion().catch(() => null),
        scannedAt,
        failureReason,
      };
    }
  }

  private async getScannerVersion(): Promise<string | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.versionPromise) {
      this.versionPromise = this.sendCommand(Buffer.from('zVERSION\0')).catch(
        (error) => {
          const message =
            error instanceof Error ? error.message : 'unknown version error';
          this.logger.warn(
            `[attachment-scan] Failed to fetch ClamAV version: ${message}`,
          );
          this.versionPromise = null;
          return null;
        },
      );
    }

    return this.versionPromise;
  }

  private async sendCommand(command: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        fn();
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on('timeout', () =>
        finish(() => {
          socket.destroy();
          reject(new Error('ClamAV request timed out'));
        }),
      );
      socket.on('error', (error) => finish(() => reject(error)));
      socket.on('close', () =>
        finish(() =>
          resolve(
            Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim(),
          ),
        ),
      );
      socket.on('connect', () => socket.end(command));
    });
  }

  private async sendInstream(stream: Readable): Promise<string> {
    const socket = net.createConnection({ host: this.host, port: this.port });
    const responseChunks: Buffer[] = [];

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        fn();
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)));
      socket.on('timeout', () => {
        stream.destroy();
        finish(() => {
          socket.destroy();
          reject(new Error('ClamAV INSTREAM timed out'));
        });
      });
      socket.on('error', (error) => {
        stream.destroy();
        finish(() => reject(error));
      });
      socket.on('close', () =>
        finish(() =>
          resolve(
            Buffer.concat(responseChunks)
              .toString('utf8')
              .replace(/\0/g, '')
              .trim(),
          ),
        ),
      );

      socket.on('connect', async () => {
        try {
          await this.writeToSocket(socket, Buffer.from('zINSTREAM\0'));

          for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const length = Buffer.alloc(4);
            length.writeUInt32BE(buffer.length, 0);
            await this.writeToSocket(socket, length);
            await this.writeToSocket(socket, buffer);
          }

          await this.writeToSocket(socket, Buffer.alloc(4));
          socket.end();
        } catch (error) {
          stream.destroy(error as Error);
          socket.destroy();
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error('Failed to scan stream'),
            ),
          );
        }
      });
    });
  }

  private async writeToSocket(socket: net.Socket, chunk: Buffer) {
    if (socket.write(chunk)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      socket.once('drain', resolve);
      socket.once('error', reject);
    });
  }
}
