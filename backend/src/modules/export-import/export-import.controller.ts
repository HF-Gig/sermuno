import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Express } from 'express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ExportImportService } from './export-import.service';
import { CreateExportJobDto } from './dto/export-import.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('export-import')
export class ExportImportController {
  constructor(private readonly service: ExportImportService) {}

  // ─── Export ──────────────────────────────────────────────────────────────

  @Post('export')
  @RequirePermission('organization:manage')
  createExport(@CurrentUser() user: JwtUser, @Body() dto: CreateExportJobDto) {
    return this.service.createExport(dto, user);
  }

  @Get('export')
  @RequirePermission('organization:manage')
  listExports(@CurrentUser() user: JwtUser) {
    return this.service.listExports(user);
  }

  @Get('export/:id')
  @RequirePermission('organization:manage')
  getExport(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.getExport(id, user);
  }

  @Get('export/:id/download')
  @RequirePermission('organization:manage')
  async downloadExport(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    const { filePath, filename, checksum, jobId } =
      await this.service.downloadExport(id, user);
    if (checksum) {
      res.setHeader('X-Export-Checksum-SHA256', checksum);
    }
    res.download(filePath, filename, async (error) => {
      if (!error) return;
      await this.service.rollbackDownloadReservation(jobId);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: 'Failed to stream export file for download' });
      }
    });
  }

  @Get('export/:id/download-url')
  @RequirePermission('organization:manage')
  async getDownloadUrl(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const { token, expiresAt, filename } = await this.service.createDownloadUrl(
      id,
      user,
    );
    const forwardedProto = req.header('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.header('x-forwarded-host')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    const host = forwardedHost || req.get('host') || 'localhost:3000';
    const origin = `${protocol}://${host}`;
    const encodedFilename = encodeURIComponent(filename);

    return {
      expiresAt,
      filename,
      url: `${origin}/export-import/export/${id}/download-direct/${encodedFilename}?token=${encodeURIComponent(token)}`,
    };
  }

  // ─── Import ──────────────────────────────────────────────────────────────

  @Post('import')
  @RequirePermission('organization:manage')
  @UseInterceptors(FileInterceptor('file'))
  createImport(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.createImport(user, file.buffer, file.originalname);
  }

  @Get('import')
  @RequirePermission('organization:manage')
  listImports(@CurrentUser() user: JwtUser) {
    return this.service.listImports(user);
  }
}
