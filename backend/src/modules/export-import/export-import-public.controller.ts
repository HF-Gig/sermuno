import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportImportService } from './export-import.service';

@Controller('export-import')
export class ExportImportPublicController {
  constructor(private readonly service: ExportImportService) {}

  @Get('export/:id/download-direct/:filename')
  @Get('export/:id/download-direct')
  async downloadExportDirect(
    @Param('id') id: string,
    @Param('filename') _filename: string | undefined,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { filePath, filename, checksum, jobId } =
      await this.service.downloadExportWithToken(id, token);
    if (checksum) {
      res.setHeader('X-Export-Checksum-SHA256', checksum);
    }
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath, async (error) => {
      if (!error) return;
      await this.service.rollbackDownloadReservation(jobId);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: 'Failed to stream export file for download' });
      }
    });
  }
}
