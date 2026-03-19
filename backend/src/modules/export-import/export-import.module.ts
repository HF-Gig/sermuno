import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaService } from '../../database/prisma.service';
import { ExportImportService } from './export-import.service';
import { ExportImportController } from './export-import.controller';

@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
      storage: undefined, // use memory storage (buffer)
    }),
  ],
  controllers: [ExportImportController],
  providers: [PrismaService, ExportImportService],
  exports: [ExportImportService],
})
export class ExportImportModule {}
