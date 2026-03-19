import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaService } from '../../database/prisma.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB direct upload limit
    }),
  ],
  controllers: [AttachmentsController],
  providers: [PrismaService, AttachmentStorageService],
  exports: [AttachmentStorageService],
})
export class AttachmentsModule {}
