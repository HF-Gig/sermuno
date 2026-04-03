import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Express } from 'express';
import { AttachmentScanStatus, type Attachment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AttachmentVirusScannerService,
  type AttachmentVirusScanResult,
} from './attachment-virus-scanner.service';
import { AttachmentStorageService } from './attachment-storage.service';

@Injectable()
export class AttachmentScanService {
  private readonly logger = new Logger(AttachmentScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly scanner: AttachmentVirusScannerService,
    private readonly audit: AuditService,
  ) {}

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

    const result = await this.scanner.scanBuffer(params.file.buffer);

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
      messageId: string;
      storageKey: string;
      filename: string;
      contentType: string | null;
      sizeBytes: number;
    },
  ): Promise<Attachment> {
    await this.assertMessageAccess(params.messageId, user.organizationId);

    const contentType = params.contentType ?? 'application/octet-stream';

    if (!this.scanner.isEnabled()) {
      return this.prisma.attachment.create({
        data: {
          messageId: params.messageId,
          filename: params.filename,
          contentType: params.contentType,
          sizeBytes: params.sizeBytes,
          storageKey: params.storageKey,
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
        storageKey: params.storageKey,
        scanStatus: AttachmentScanStatus.PENDING,
      },
    });

    const result = await this.scanner.scanStream(
      await this.storage.getReadStream(params.storageKey),
    );

    return this.finalizeUploadScan({
      attachment,
      organizationId: user.organizationId,
      actorUserId: user.sub,
      contentType,
      result,
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
    result: AttachmentVirusScanResult;
    uploadBuffer?: Buffer;
  }): Promise<Attachment> {
    const { attachment, organizationId, actorUserId, contentType, result } =
      params;

    if (result.status === 'clean') {
      try {
        if (params.uploadBuffer) {
          await this.storage.upload(
            attachment.storageKey,
            params.uploadBuffer,
            contentType,
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

      try {
        if (params.uploadBuffer) {
          await this.storage.upload(
            quarantineKey,
            params.uploadBuffer,
            contentType,
          );
        } else {
          await this.storage.move(attachment.storageKey, quarantineKey);
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

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'attachment.scan.failed',
      entityType: 'attachment',
      entityId: attachment.id,
      newValue: {
        filename: attachment.filename,
        storageKey: attachment.storageKey,
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
}
