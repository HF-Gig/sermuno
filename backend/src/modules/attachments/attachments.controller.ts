import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Express } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AttachmentScanService } from './attachment-scan.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { PrismaService } from '../../database/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly storage: AttachmentStorageService,
    private readonly attachmentScan: AttachmentScanService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /attachments/upload
   * Direct upload (small files) — stores and records in DB.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('messageId') messageId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!messageId) throw new BadRequestException('messageId is required');
    return this.attachmentScan.createDirectUploadAttachment(user, {
      messageId,
      file,
    });
  }

  /**
   * POST /attachments/presign
   * Request a pre-signed S3 PUT URL for large file upload.
   */
  @Post('presign')
  async presign(
    @CurrentUser() user: JwtUser,
    @Body('messageId') messageId: string,
    @Body('filename') filename: string,
    @Body('contentType') contentType: string,
    @Body('sizeBytes') sizeBytes: number,
  ) {
    if (!messageId) throw new BadRequestException('messageId is required');
    if (!filename) throw new BadRequestException('filename is required');
    if (!contentType) throw new BadRequestException('contentType is required');

    return this.attachmentScan.createPresignedUpload(user, {
      contentType,
      filename,
      messageId,
      sizeBytes: sizeBytes ?? 0,
    });
  }

  /**
   * POST /attachments/confirm
   * After client uploads directly to S3, record the attachment in DB.
   */
  @Post('confirm')
  async confirm(
    @CurrentUser() user: JwtUser,
    @Body('messageId') messageId: string,
    @Body('storageKey') storageKey: string,
    @Body('filename') filename: string,
    @Body('contentType') contentType: string,
    @Body('sizeBytes') sizeBytes: number,
    @Body('uploadToken') uploadToken: string,
  ) {
    if (!messageId || !storageKey || !filename || !uploadToken) {
      throw new BadRequestException(
        'messageId, storageKey, filename, uploadToken are required',
      );
    }
    return this.attachmentScan.confirmUploadedAttachment(user, {
      messageId,
      storageKey,
      filename,
      contentType: contentType ?? null,
      sizeBytes: sizeBytes ?? 0,
      uploadToken,
    });
  }

  /**
   * GET /attachments/:id/download-link
   * Returns a signed download URL for attachment by ID.
   */
  @Get(':id/download-link')
  async downloadLink(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        message: { thread: { organizationId: user.organizationId } },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    const approvedAttachment =
      await this.attachmentScan.ensureAttachmentDownloadAllowed(
      attachment,
      user.sub,
    );

    const url = this.storage.isS3Storage()
      ? await this.storage.presignedGetUrl(approvedAttachment.storageKey)
      : `/attachments/${encodeURIComponent(approvedAttachment.id)}/download`;

    return { url, expiresIn: 3600 };
  }

  /**
   * GET /attachments/:id/download
   * Download an attachment by ID.
   */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
    @Query('inline') inline?: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        message: { thread: { organizationId: user.organizationId } },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    const approvedAttachment =
      await this.attachmentScan.ensureAttachmentDownloadAllowed(
        attachment,
        user.sub,
      );

    const disposition = inline === 'true' ? 'inline' : 'attachment';

    // S3: redirect to pre-signed GET URL
    if (this.storage.isS3Storage()) {
      const url = await this.storage.presignedGetUrl(
        approvedAttachment.storageKey,
      );
      res.redirect(url);
      return;
    }

    // Local storage: stream directly
    const buffer = await this.storage.getLocalBuffer(
      approvedAttachment.storageKey,
    );
    res.setHeader(
      'Content-Type',
      approvedAttachment.contentType ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${approvedAttachment.filename}"`,
    );
    res.send(buffer);
  }

  /**
   * DELETE /attachments/:id
   * Delete attachment from storage + DB.
   */
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        message: { thread: { organizationId: user.organizationId } },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.storage.delete(attachment.storageKey);
    await this.prisma.attachment.delete({ where: { id } });

    return { success: true };
  }
}
