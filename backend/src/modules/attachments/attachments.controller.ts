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
import { AttachmentStorageService } from './attachment-storage.service';
import { PrismaService } from '../../database/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly storage: AttachmentStorageService,
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

    // Verify message belongs to org
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, thread: { organizationId: user.organizationId } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const storageKey = this.storage.generateStorageKey(
      user.organizationId,
      file.originalname,
    );
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const attachment = await this.prisma.attachment.create({
      data: {
        message: { connect: { id: messageId } },
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
      },
    });

    return attachment;
  }

  /**
   * POST /attachments/presign
   * Request a pre-signed S3 PUT URL for large file upload.
   */
  @Post('presign')
  async presign(
    @CurrentUser() user: JwtUser,
    @Body('filename') filename: string,
    @Body('contentType') contentType: string,
    @Body('sizeBytes') sizeBytes: number,
  ) {
    if (!filename) throw new BadRequestException('filename is required');
    if (!contentType) throw new BadRequestException('contentType is required');

    const storageKey = this.storage.generateStorageKey(
      user.organizationId,
      filename,
    );
    const url = await this.storage.presignedPutUrl(storageKey, contentType);
    return { storageKey, url };
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
  ) {
    if (!messageId || !storageKey || !filename) {
      throw new BadRequestException(
        'messageId, storageKey, filename are required',
      );
    }

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, thread: { organizationId: user.organizationId } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const attachment = await this.prisma.attachment.create({
      data: {
        message: { connect: { id: messageId } },
        filename,
        contentType: contentType ?? null,
        sizeBytes: sizeBytes ?? 0,
        storageKey,
      },
    });

    return attachment;
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

    const url = this.storage.requiresPresign(attachment.sizeBytes)
      ? await this.storage.presignedGetUrl(attachment.storageKey)
      : `/attachments/${encodeURIComponent(attachment.id)}/download`;

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

    const disposition = inline === 'true' ? 'inline' : 'attachment';

    // S3: redirect to pre-signed GET URL
    if (this.storage.requiresPresign(attachment.sizeBytes)) {
      const url = await this.storage.presignedGetUrl(attachment.storageKey);
      res.redirect(url);
      return;
    }

    // Local or small S3: stream directly
    const buffer = await this.storage.getLocalBuffer(attachment.storageKey);
    res.setHeader(
      'Content-Type',
      attachment.contentType ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${attachment.filename}"`,
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
