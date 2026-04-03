import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaService } from '../../database/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { AttachmentScanService } from './attachment-scan.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentVirusScannerService } from './attachment-virus-scanner.service';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [
    AuditModule,
    MulterModule.register({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB direct upload limit
    }),
  ],
  controllers: [AttachmentsController],
  providers: [
    PrismaService,
    AttachmentStorageService,
    AttachmentVirusScannerService,
    AttachmentScanService,
  ],
  exports: [
    AttachmentStorageService,
    AttachmentVirusScannerService,
    AttachmentScanService,
  ],
})
export class AttachmentsModule {}
