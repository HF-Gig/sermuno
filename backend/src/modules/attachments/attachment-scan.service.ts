import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { AttachmentScanStatus, type Attachment } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AttachmentVirusScannerService,
  type AttachmentVirusScanResult,
} from './attachment-virus-scanner.service';
import { AttachmentStorageService } from './attachment-storage.service';

type AttachmentUploadTokenPayload = {
  actorUserId: string;
  contentType: string;
  expiresAt: number;
  filename: string;
  finalStorageKey: string;
  messageId: string;
  organizationId: string;
  sizeBytes: number;
  stagingStorageKey: string;
  version: 1;
};

@Injectable()
export class AttachmentScanService {
  private readonly logger = new Logger(AttachmentScanService.name);
  private readonly presignedUploadTtlSeconds = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly scanner: AttachmentVirusScannerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createPresignedUpload(
    user: JwtUser,
    params: {
      contentType: string;
      filename: string;
      messageId: string;
      sizeBytes: number;
    },
  ): Promise<{
    expiresIn: number;
    finalStorageKey: string;
    requiresConfirm: true;
    storageKey: string;
    uploadToken: string;
    url: string;
  }> {
    await this.assertMessageAccess(params.messageId, user.organizationId);

    if (!this.storage.isS3Storage()) {
      throw new BadRequestException(
        'Presigned attachment uploads require S3-compatible storage',
      );
    }

    const contentType = params.contentType || 'application/octet-stream';
    const stagingStorageKey = this.storage.generateStagingKey(
      user.organizationId,
      params.filename,
    );
    const finalStorageKey = this.storage.generateStorageKey(
      user.organizationId,
      params.filename,
    );
    const uploadToken = this.signUploadToken({
      actorUserId: user.sub,
      contentType,
      expiresAt:
        Date.now() + this.presignedUploadTtlSeconds * 1000,
      filename: params.filename,
      finalStorageKey,
      messageId: params.messageId,
      organizationId: user.organizationId,
      sizeBytes: Math.max(Number(params.sizeBytes || 0), 0),
      stagingStorageKey,
      version: 1,
    });
    const url = await this.storage.presignedPutUrl(
      stagingStorageKey,
      contentType,
      this.presignedUploadTtlSeconds,
    );

    return {
      expiresIn: this.presignedUploadTtlSeconds,
      finalStorageKey,
      requiresConfirm: true,
      storageKey: stagingStorageKey,
      uploadToken,
      url,
    };
  }

  async createDirectUploadAttachment(
    user: JwtUser,
    params: {
      messageId: string;
      file: Express.Multer.File;
    },
  ): Promise<Attachment> {
    await this.assertMessageAccess(params.messageId, user.organizationId);

    const contentType = params.file.mimetype || 'application/octet-stream';
    const storageKey = this.storage.generateStorageKey(
      user.organizationId,
      params.file.originalname,
    );

    if (!this.scanner.isEnabled()) {
      await this.storage.upload(storageKey, params.file.buffer, contentType);
      return this.prisma.attachment.create({
        data: {
          messageId: params.messageId,
          filename: params.file.originalname,
          contentType,
          sizeBytes: params.file.size,
          storageKey,
          scanStatus: AttachmentScanStatus.UNSCANNED,
        },
      });
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        messageId: params.messageId,
        filename: params.file.originalname,
        contentType,
        sizeBytes: params.file.size,
        storageKey,
        scanStatus: AttachmentScanStatus.PENDING,
      },
    });

    let result: AttachmentVirusScanResult;
    try {
      result = await this.scanner.scanBuffer(params.file.buffer);
    } catch (error) {
      result = {
        failureReason: this.stringifyError(error),
        scannedAt: new Date(),
        scannerName: this.scanner.getScannerName(),
        scannerVersion: null,
        status: 'failed',
      };
    }

    return this.finalizeUploadScan({
      attachment,
      organizationId: user.organizationId,
      actorUserId: user.sub,
      contentType,
      uploadBuffer: params.file.buffer,
      result,
    });
  }

  async confirmUploadedAttachment(
    user: JwtUser,
    params: {
      contentType: string | null;
      filename: string;
      messageId: string;
      sizeBytes: number;
      storageKey: string;
      uploadToken: string;
    },
  ): Promise<Attachment> {
    await this.assertMessageAccess(params.messageId, user.organizationId);

    const uploadToken = String(params.uploadToken || '').trim();
    if (!uploadToken) {
      throw new BadRequestException('uploadToken is required');
    }

    const payload = this.verifyUploadToken(uploadToken);
    const contentType = params.contentType ?? 'application/octet-stream';
    const requestedStorageKey = String(params.storageKey || '').trim();

    if (payload.organizationId !== user.organizationId) {
      throw new ForbiddenException('Upload token does not belong to this organization');
    }

    if (payload.actorUserId !== user.sub) {
      throw new ForbiddenException('Upload token does not belong to this user');
    }

    if (payload.messageId !== params.messageId) {
      throw new BadRequestException('Upload token message mismatch');
    }

    if (payload.stagingStorageKey !== requestedStorageKey) {
      throw new BadRequestException('Upload token storage key mismatch');
    }

    if (payload.filename !== params.filename) {
      throw new BadRequestException('Upload token filename mismatch');
    }

    if (payload.contentType !== contentType) {
      throw new BadRequestException('Upload token content type mismatch');
    }

    if (payload.sizeBytes !== Math.max(Number(params.sizeBytes || 0), 0)) {
      throw new BadRequestException('Upload token size mismatch');
    }

    const metadata = await this.storage.getMetadata(payload.stagingStorageKey);

    if (metadata.sizeBytes !== payload.sizeBytes) {
      throw new BadRequestException('Uploaded file size does not match the requested upload');
    }

    if (
      metadata.contentType &&
      payload.contentType &&
      metadata.contentType !== payload.contentType
    ) {
      throw new BadRequestException('Uploaded file content type does not match the requested upload');
    }

    if (!this.scanner.isEnabled()) {
      await this.storage.move(
        payload.stagingStorageKey,
        payload.finalStorageKey,
      );

      return this.prisma.attachment.create({
        data: {
          messageId: params.messageId,
          filename: params.filename,
          contentType: params.contentType,
          sizeBytes: params.sizeBytes,
          storageKey: payload.finalStorageKey,
          scanStatus: AttachmentScanStatus.UNSCANNED,
        },
      });
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        messageId: params.messageId,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        storageKey: payload.stagingStorageKey,
        scanStatus: AttachmentScanStatus.PENDING,
      },
    });

    let result: AttachmentVirusScanResult;
    try {
      result = await this.scanner.scanStream(
        await this.storage.getReadStream(payload.stagingStorageKey),
      );
    } catch (error) {
      result = {
        failureReason: this.stringifyError(error),
        scannedAt: new Date(),
        scannerName: this.scanner.getScannerName(),
        scannerVersion: null,
        status: 'failed',
      };
    }

    return this.finalizeUploadScan({
      attachment,
      organizationId: user.organizationId,
      actorUserId: user.sub,
      contentType,
      finalStorageKey: payload.finalStorageKey,
      result,
      sourceStorageKey: payload.stagingStorageKey,
    });
  }

  async ensureAttachmentDownloadAllowed(
    attachment: Attachment,
    actorUserId?: string,
  ): Promise<Attachment> {
    if (
      attachment.scanStatus === AttachmentScanStatus.INFECTED ||
      attachment.quarantinedAt
    ) {
      throw new ForbiddenException(
        'Attachment is quarantined and cannot be downloaded',
      );
    }

    if (!this.scanner.isEnabled()) {
      return attachment;
    }

    if (attachment.scanStatus === AttachmentScanStatus.CLEAN) {
      return attachment;
    }

    if (attachment.scanStatus === AttachmentScanStatus.UNSCANNED) {
      if (!this.scanner.shouldScanOnDownload()) {
        throw new ForbiddenException(
          'Attachment has not been scanned and download scanning is disabled',
        );
      }

      const result = await this.scanner.scanStream(
        await this.storage.getReadStream(attachment.storageKey),
      );

      return this.finalizeDownloadScan({
        attachment,
        actorUserId,
        result,
      });
    }

    if (attachment.scanStatus === AttachmentScanStatus.PENDING) {
      throw new ConflictException(
        'Attachment scan is pending and the file is not downloadable yet',
      );
    }

    throw new ServiceUnavailableException(
      'Attachment scan failed and download is blocked',
    );
  }

  private async finalizeUploadScan(params: {
    attachment: Attachment;
    organizationId: string;
    actorUserId: string;
    contentType: string;
    finalStorageKey?: string;
    result: AttachmentVirusScanResult;
    sourceStorageKey?: string;
    uploadBuffer?: Buffer;
  }): Promise<Attachment> {
    const {
      attachment,
      organizationId,
      actorUserId,
      contentType,
      finalStorageKey,
      result,
      sourceStorageKey,
    } =
      params;

    if (result.status === 'clean') {
      let storageKey = attachment.storageKey;
      try {
        if (params.uploadBuffer) {
          await this.storage.upload(
            attachment.storageKey,
            params.uploadBuffer,
            contentType,
          );
        } else if (sourceStorageKey && finalStorageKey) {
          storageKey = await this.storage.move(
            sourceStorageKey,
            finalStorageKey,
          );
        }
      } catch (error) {
        await this.prisma.attachment.update({
          where: { id: attachment.id },
          data: {
            scanStatus: AttachmentScanStatus.FAILED,
            scannerName: result.scannerName,
            scannerVersion: result.scannerVersion,
            scannedAt: result.scannedAt,
            scanFailureReason: `Storage write failed: ${this.stringifyError(error)}`,
            quarantinedAt: new Date(),
          },
        });

        throw new ServiceUnavailableException(
          'Attachment upload failed after the malware scan completed',
        );
      }

      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          ...(storageKey !== attachment.storageKey
            ? { storageKey }
            : {}),
          scanStatus: AttachmentScanStatus.CLEAN,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          scanFailureReason: null,
          malwareSignature: null,
          quarantinedAt: null,
        },
      });

      this.logger.log(
        `[attachment-scan] attachment=${attachment.id} status=clean scanner=${result.scannerName} storageKey=${updated.storageKey}`,
      );

      return updated;
    }

    if (result.status === 'infected') {
      const quarantineKey = this.storage.generateQuarantineKey(
        organizationId,
        attachment.filename,
      );
      const sourceKey = sourceStorageKey ?? attachment.storageKey;

      try {
        if (params.uploadBuffer) {
          await this.storage.upload(
            quarantineKey,
            params.uploadBuffer,
            contentType,
          );
        } else {
          await this.storage.move(sourceKey, quarantineKey);
        }
      } catch (error) {
        await this.prisma.attachment.update({
          where: { id: attachment.id },
          data: {
            scanStatus: AttachmentScanStatus.FAILED,
            scannerName: result.scannerName,
            scannerVersion: result.scannerVersion,
            scannedAt: result.scannedAt,
            scanFailureReason: `Quarantine failed: ${this.stringifyError(error)}`,
            quarantinedAt: new Date(),
          },
        });
        throw new ServiceUnavailableException(
          'Attachment scan detected malware but quarantine failed',
        );
      }

      await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          storageKey: quarantineKey,
          scanStatus: AttachmentScanStatus.INFECTED,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          malwareSignature: result.malwareSignature,
          scanFailureReason: null,
          quarantinedAt: new Date(),
        },
      });

      await this.audit.log({
        organizationId,
        userId: actorUserId,
        action: 'attachment.scan.infected',
        entityType: 'attachment',
        entityId: attachment.id,
        newValue: {
          filename: attachment.filename,
          storageKey: quarantineKey,
          malwareSignature: result.malwareSignature,
          scanner: result.scannerName,
        },
      });

      this.logger.warn(
        `[attachment-scan] attachment=${attachment.id} status=infected signature=${result.malwareSignature} quarantineKey=${quarantineKey}`,
      );

      throw new UnprocessableEntityException(
        `Attachment blocked by malware scan: ${result.malwareSignature}`,
      );
    }

    if (this.scanner.shouldFailOpenOnError()) {
      let fallbackStorageKey = attachment.storageKey;

      try {
        if (params.uploadBuffer) {
          await this.storage.upload(
            attachment.storageKey,
            params.uploadBuffer,
            contentType,
          );
        } else if (sourceStorageKey && finalStorageKey) {
          fallbackStorageKey = await this.storage.move(
            sourceStorageKey,
            finalStorageKey,
          );
        }
      } catch (error) {
        await this.prisma.attachment.update({
          where: { id: attachment.id },
          data: {
            scanStatus: AttachmentScanStatus.FAILED,
            scannerName: result.scannerName,
            scannerVersion: result.scannerVersion,
            scannedAt: result.scannedAt,
            scanFailureReason: `Scan fallback storage failed: ${this.stringifyError(error)}`,
            quarantinedAt: new Date(),
          },
        });

        throw new ServiceUnavailableException(
          'Attachment upload failed while recovering from a scanner error',
        );
      }

      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          ...(fallbackStorageKey !== attachment.storageKey
            ? { storageKey: fallbackStorageKey }
            : {}),
          scanStatus: AttachmentScanStatus.UNSCANNED,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          scanFailureReason: result.failureReason,
          malwareSignature: null,
          quarantinedAt: null,
        },
      });

      await this.audit.log({
        organizationId,
        userId: actorUserId,
        action: 'attachment.scan.failed_open',
        entityType: 'attachment',
        entityId: attachment.id,
        newValue: {
          filename: attachment.filename,
          storageKey: updated.storageKey,
          failureReason: result.failureReason,
          scanner: result.scannerName,
        },
      });

      this.logger.warn(
        `[attachment-scan] attachment=${attachment.id} status=failed-open reason=${result.failureReason}`,
      );

      return updated;
    }

    const quarantineKey = sourceStorageKey
      ? this.storage.generateQuarantineKey(
          organizationId,
          attachment.filename,
        )
      : null;
    let failedStorageKey = attachment.storageKey;

    if (quarantineKey && sourceStorageKey) {
      try {
        failedStorageKey = await this.storage.move(
          sourceStorageKey,
          quarantineKey,
        );
      } catch (error) {
        this.logger.error(
          `[attachment-scan] attachment=${attachment.id} quarantine move failed after scan failure: ${this.stringifyError(error)}`,
        );
      }
    }

    await this.prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        ...(failedStorageKey !== attachment.storageKey
          ? { storageKey: failedStorageKey }
          : {}),
        scanStatus: AttachmentScanStatus.FAILED,
        scannerName: result.scannerName,
        scannerVersion: result.scannerVersion,
        scannedAt: result.scannedAt,
        scanFailureReason: result.failureReason,
        quarantinedAt: new Date(),
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'attachment.scan.failed',
      entityType: 'attachment',
      entityId: attachment.id,
      newValue: {
        filename: attachment.filename,
        storageKey: failedStorageKey,
        failureReason: result.failureReason,
        scanner: result.scannerName,
      },
    });

    this.logger.error(
      `[attachment-scan] attachment=${attachment.id} status=failed reason=${result.failureReason}`,
    );

    throw new ServiceUnavailableException(
      'Attachment scan failed and the upload was blocked',
    );
  }

  private async finalizeDownloadScan(params: {
    attachment: Attachment;
    actorUserId?: string;
    result: AttachmentVirusScanResult;
  }): Promise<Attachment> {
    const { attachment, result } = params;

    if (result.status === 'clean') {
      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          scanStatus: AttachmentScanStatus.CLEAN,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          scanFailureReason: null,
          malwareSignature: null,
          quarantinedAt: null,
        },
      });

      this.logger.log(
        `[attachment-scan] attachment=${attachment.id} status=clean source=download scanner=${result.scannerName}`,
      );

      return updated;
    }

    const quarantineKey = this.storage.generateQuarantineKey(
      await this.resolveOrganizationId(attachment.id),
      attachment.filename,
    );

    if (result.status === 'infected') {
      let storageKey = attachment.storageKey;

      try {
        storageKey = await this.storage.move(
          attachment.storageKey,
          quarantineKey,
        );
      } catch (error) {
        this.logger.error(
          `[attachment-scan] attachment=${attachment.id} quarantine move failed on download: ${this.stringifyError(error)}`,
        );
      }

      await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          storageKey,
          scanStatus: AttachmentScanStatus.INFECTED,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          malwareSignature: result.malwareSignature,
          scanFailureReason: null,
          quarantinedAt: new Date(),
        },
      });

      throw new ForbiddenException(
        'Attachment is quarantined and cannot be downloaded',
      );
    }

    if (this.scanner.shouldFailOpenOnError()) {
      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          scanStatus: AttachmentScanStatus.UNSCANNED,
          scannerName: result.scannerName,
          scannerVersion: result.scannerVersion,
          scannedAt: result.scannedAt,
          scanFailureReason: result.failureReason,
          quarantinedAt: null,
        },
      });

      this.logger.warn(
        `[attachment-scan] attachment=${attachment.id} status=download-failed-open reason=${result.failureReason}`,
      );

      return updated;
    }

    await this.prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        scanStatus: AttachmentScanStatus.FAILED,
        scannerName: result.scannerName,
        scannerVersion: result.scannerVersion,
        scannedAt: result.scannedAt,
        scanFailureReason: result.failureReason,
        quarantinedAt: new Date(),
      },
    });

    throw new ServiceUnavailableException(
      'Attachment scan failed and download is blocked',
    );
  }

  private async assertMessageAccess(messageId: string, organizationId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, thread: { organizationId } },
      select: { id: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  private async resolveOrganizationId(attachmentId: string): Promise<string> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        message: {
          select: {
            thread: {
              select: {
                organizationId: true,
              },
            },
          },
        },
      },
    });

    const organizationId = attachment?.message.thread.organizationId;
    if (!organizationId) {
      throw new NotFoundException('Attachment organization not found');
    }

    return organizationId;
  }

  private stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private signUploadToken(payload: AttachmentUploadTokenPayload): string {
    const serializedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getUploadTokenSecret())
      .update(serializedPayload)
      .digest('base64url');

    return `${serializedPayload}.${signature}`;
  }

  private verifyUploadToken(token: string): AttachmentUploadTokenPayload {
    const [serializedPayload, signature] = String(token || '').split('.');
    if (!serializedPayload || !signature) {
      throw new BadRequestException('Invalid upload token');
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.getUploadTokenSecret())
      .update(serializedPayload)
      .digest('base64url');
    const providedSignature = Buffer.from(signature, 'utf8');
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

    if (
      providedSignature.length !== expectedSignatureBuffer.length ||
      !crypto.timingSafeEqual(providedSignature, expectedSignatureBuffer)
    ) {
      throw new ForbiddenException('Upload token signature is invalid');
    }

    let payload: AttachmentUploadTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(serializedPayload, 'base64url').toString('utf8'),
      ) as AttachmentUploadTokenPayload;
    } catch {
      throw new BadRequestException('Upload token payload is invalid');
    }

    if (payload.version !== 1) {
      throw new BadRequestException('Upload token version is not supported');
    }

    if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
      throw new ForbiddenException('Upload token has expired');
    }

    return payload;
  }

  private getUploadTokenSecret(): string {
    const configuredSecret =
      this.config.get<string>('encryption.key') ??
      this.config.get<string>('jwt.secret') ??
      '';

    if (configuredSecret.trim()) {
      return configuredSecret;
    }

    throw new ServiceUnavailableException(
      'Attachment upload token signing is not configured',
    );
  }
}
