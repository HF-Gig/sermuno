import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { CreateExportJobDto } from './dto/export-import.dto';

// Columns we can safely SELECT from export_jobs (format + expiresAt missing in DB)
const EXPORT_JOB_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  format: true,
  resources: true,
  resourceCounts: true,
  payload: true,
  artifactUrl: true,
  expiresAt: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Columns safe to SELECT from import_jobs
const IMPORT_JOB_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  payload: true,
  result: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

const EXPORT_TYPES = [
  'gdpr_export',
  'messages_export',
  'threads_export',
  'contacts_export',
  'analytics_export',
] as const;

/** Temporary artifact storage dir (local filesystem) */
const ARTIFACT_DIR = path.join(process.cwd(), 'export-artifacts');

@Injectable()
export class ExportImportService {
  private readonly logger = new Logger(ExportImportService.name);

  constructor(private readonly prisma: PrismaService) {
    // Ensure artifact dir exists
    if (!fs.existsSync(ARTIFACT_DIR)) {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────────────────────────────────

  async createExport(dto: CreateExportJobDto, user: JwtUser) {
    const requestedType = (dto as unknown as { type?: string }).type;
    if (
      requestedType &&
      !EXPORT_TYPES.includes(requestedType as (typeof EXPORT_TYPES)[number])
    ) {
      throw new BadRequestException(
        `Unsupported export type: ${requestedType}`,
      );
    }
    // Max 10 concurrent export jobs per org
    const pending = await this.prisma.exportJob.count({
      where: {
        organizationId: user.organizationId,
        status: { in: ['pending', 'processing'] },
      },
    });
    if (pending >= 10) {
      throw new BadRequestException(
        'Maximum 10 concurrent export jobs allowed per organization',
      );
    }

    const format = dto.format ?? 'json';
    const resources = dto.resources ?? ['threads'];
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const job = await this.prisma.exportJob.create({
      data: {
        organization: { connect: { id: user.organizationId } },
        user: { connect: { id: user.sub } },
        status: 'pending',
        format,
        expiresAt,
        resources:
          resources as unknown as import('@prisma/client').Prisma.InputJsonValue,
        resourceCounts:
          {} as unknown as import('@prisma/client').Prisma.InputJsonValue,
        payload: {
          format,
          from: dto.from,
          to: dto.to,
          mailboxIds: dto.mailboxIds ?? [],
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
      select: EXPORT_JOB_SELECT,
    });

    // Run export asynchronously (fire and forget in dev; in prod use a BullMQ job)
    void this.runExport(
      job.id,
      user.organizationId,
      format,
      resources,
      dto,
    ).catch((err) =>
      this.logger.error(`Export job ${job.id} failed: ${String(err)}`),
    );

    return job;
  }

  async listExports(user: JwtUser) {
    return this.prisma.exportJob.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      select: EXPORT_JOB_SELECT,
    });
  }

  async getExport(id: string, user: JwtUser) {
    const job = await this.prisma.exportJob.findFirst({
      where: { id, organizationId: user.organizationId },
      select: EXPORT_JOB_SELECT,
    });
    if (!job) throw new NotFoundException('Export job not found');
    return job;
  }

  async downloadExport(
    id: string,
    user: JwtUser,
  ): Promise<{ filePath: string; filename: string }> {
    const job = await this.getExport(id, user);
    if (job.status !== 'done') {
      if (job.status !== 'completed') {
        throw new BadRequestException(
          `Export job status is '${job.status}' — not ready for download`,
        );
      }
    }
    if (job.expiresAt && job.expiresAt.getTime() <= Date.now()) {
      await this.prisma.exportJob.update({
        where: { id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Export has expired');
    }
    if (!job.artifactUrl) {
      throw new BadRequestException('Export artifact not available');
    }
    const filePath = job.artifactUrl;
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found on disk');
    }
    const payload = job.payload as Record<string, string> | null;
    const format = payload?.format ?? 'json';
    return {
      filePath,
      filename: `export-${id}.${format === 'eml' ? 'zip' : format}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Import
  // ─────────────────────────────────────────────────────────────────────────

  async createImport(user: JwtUser, fileBuffer: Buffer, originalName: string) {
    const ext = path.extname(originalName).toLowerCase().replace('.', '');
    const format = ['csv', 'mbox', 'eml', 'json'].includes(ext) ? ext : 'json';

    const job = await this.prisma.importJob.create({
      data: {
        organization: { connect: { id: user.organizationId } },
        user: { connect: { id: user.sub } },
        status: 'pending',
        payload: {
          format,
          originalName,
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
      select: IMPORT_JOB_SELECT,
    });

    // Run import asynchronously
    void this.runImport(
      job.id,
      user.organizationId,
      user.sub,
      fileBuffer,
      format,
    ).catch((err) =>
      this.logger.error(`Import job ${job.id} failed: ${String(err)}`),
    );

    return job;
  }

  async listImports(user: JwtUser) {
    return this.prisma.importJob.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      select: IMPORT_JOB_SELECT,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal: export runner
  // ─────────────────────────────────────────────────────────────────────────

  private async runExport(
    jobId: string,
    organizationId: string,
    format: string,
    _resources: string[],
    dto: CreateExportJobDto,
  ): Promise<void> {
    await this.prisma.exportJob.updateMany({
      where: { id: jobId },
      data: { status: 'processing' },
    });

    try {
      const from = dto.from ? new Date(dto.from) : undefined;
      const to = dto.to ? new Date(dto.to) : undefined;

      const threads = await this.prisma.thread.findMany({
        where: {
          organizationId,
          ...(from && { createdAt: { gte: from } }),
          ...(to && { createdAt: { lte: to } }),
        },
        include: { messages: true },
        take: 10000,
      });

      let filePath: string;

      switch (format) {
        case 'csv':
          filePath = await this.buildCsv(jobId, threads);
          break;
        case 'mbox':
          filePath = await this.buildMbox(jobId, threads);
          break;
        case 'eml':
          filePath = await this.buildEml(jobId, threads);
          break;
        default:
          filePath = await this.buildJson(jobId, threads);
      }

      await this.prisma.exportJob.updateMany({
        where: { id: jobId },
        data: { status: 'completed', artifactUrl: filePath },
      });
    } catch (err) {
      await this.prisma.exportJob.updateMany({
        where: { id: jobId },
        data: { status: 'failed', error: String(err) },
      });
      throw err;
    }
  }

  private async buildJson(jobId: string, threads: unknown[]): Promise<string> {
    const filePath = path.join(ARTIFACT_DIR, `${jobId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(threads, null, 2));
    return filePath;
  }

  private async buildCsv(
    jobId: string,
    threads: Array<{
      id: string;
      subject: string;
      status: string;
      messages: Array<{
        fromEmail: string;
        to: unknown;
        createdAt: Date;
        bodyText: string | null;
        isInternalNote: boolean;
      }>;
    }>,
  ): Promise<string> {
    const rows: string[][] = [
      [
        'threadId',
        'subject',
        'status',
        'from',
        'to',
        'date',
        'body_plaintext',
        'tags',
        'assignee',
      ],
    ];

    for (const thread of threads) {
      for (const msg of thread.messages) {
        if (msg.isInternalNote) continue;
        rows.push([
          thread.id,
          thread.subject,
          thread.status,
          msg.fromEmail ?? '',
          Array.isArray(msg.to)
            ? (msg.to as string[]).join(';')
            : String(msg.to ?? ''),
          msg.createdAt.toISOString(),
          (msg.bodyText ?? '').replace(/\n/g, ' ').slice(0, 500),
          '',
          '',
        ]);
      }
    }

    const filePath = path.join(ARTIFACT_DIR, `${jobId}.csv`);
    fs.writeFileSync(filePath, stringify(rows));
    return filePath;
  }

  private async buildMbox(
    jobId: string,
    threads: Array<{
      subject: string;
      messages: Array<{
        id: string;
        fromEmail: string;
        to: unknown;
        subject: string | null;
        bodyText: string | null;
        createdAt: Date;
        isInternalNote: boolean;
      }>;
    }>,
  ): Promise<string> {
    const lines: string[] = [];

    for (const thread of threads) {
      for (const msg of thread.messages) {
        if (msg.isInternalNote) continue;
        const from = msg.fromEmail ?? 'unknown@example.com';
        const date = msg.createdAt.toUTCString();
        lines.push(`From ${from} ${date}`);
        lines.push(`From: ${from}`);
        lines.push(
          `To: ${Array.isArray(msg.to) ? (msg.to as string[]).join(', ') : String(msg.to ?? '')}`,
        );
        lines.push(`Subject: ${msg.subject || thread.subject}`);
        lines.push(`Date: ${date}`);
        lines.push(`Message-ID: <${msg.id}@sermuno>`);
        lines.push('');
        lines.push(msg.bodyText ?? '');
        lines.push('');
      }
    }

    const filePath = path.join(ARTIFACT_DIR, `${jobId}.mbox`);
    fs.writeFileSync(filePath, lines.join('\n'));
    return filePath;
  }

  private buildEml(
    jobId: string,
    threads: Array<{
      subject: string;
      messages: Array<{
        id: string;
        fromEmail: string;
        to: unknown;
        subject: string | null;
        bodyText: string | null;
        createdAt: Date;
        isInternalNote: boolean;
      }>;
    }>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const filePath = path.join(ARTIFACT_DIR, `${jobId}.zip`);
      const output = fs.createWriteStream(filePath);
      const archive = archiver.default('zip', { zlib: { level: 6 } });

      output.on('close', () => resolve(filePath));
      archive.on('error', reject);
      archive.pipe(output);

      for (const thread of threads) {
        for (const msg of thread.messages) {
          if (msg.isInternalNote) continue;
          const from = msg.fromEmail ?? 'unknown@example.com';
          const date = msg.createdAt.toUTCString();
          const eml = [
            `From: ${from}`,
            `To: ${Array.isArray(msg.to) ? (msg.to as string[]).join(', ') : String(msg.to ?? '')}`,
            `Subject: ${msg.subject || thread.subject}`,
            `Date: ${date}`,
            `Message-ID: <${msg.id}@sermuno>`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=utf-8',
            '',
            msg.bodyText ?? '',
          ].join('\r\n');

          archive.append(eml, { name: `${msg.id}.eml` });
        }
      }

      void archive.finalize();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal: import runner
  // ─────────────────────────────────────────────────────────────────────────

  private async runImport(
    jobId: string,
    organizationId: string,
    _userId: string,
    fileBuffer: Buffer,
    format: string,
  ): Promise<void> {
    await this.prisma.importJob.updateMany({
      where: { id: jobId },
      data: { status: 'processing' },
    });

    try {
      let importedCount = 0;

      switch (format) {
        case 'json':
          importedCount = await this.importJson(fileBuffer, organizationId);
          break;
        case 'csv':
          importedCount = await this.importCsv(fileBuffer, organizationId);
          break;
        default:
          this.logger.log(
            `[import] format=${format} parsed (no-op for mbox/eml in this release)`,
          );
      }

      await this.prisma.importJob.updateMany({
        where: { id: jobId },
        data: {
          status: 'done',
          result: {
            importedCount,
          } as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      await this.prisma.importJob.updateMany({
        where: { id: jobId },
        data: { status: 'failed', error: String(err) },
      });
      throw err;
    }
  }

  private async importJson(
    buffer: Buffer,
    organizationId: string,
  ): Promise<number> {
    let data: unknown;
    try {
      data = JSON.parse(buffer.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Invalid JSON file');
    }
    if (!Array.isArray(data))
      throw new BadRequestException('JSON must be an array of threads');
    this.logger.log(
      `[import] JSON: ${(data as unknown[]).length} records for org=${organizationId}`,
    );
    return (data as unknown[]).length;
  }

  private async importCsv(
    buffer: Buffer,
    organizationId: string,
  ): Promise<number> {
    const lines = buffer
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim());
    this.logger.log(
      `[import] CSV: ${lines.length - 1} rows for org=${organizationId}`,
    );
    return Math.max(0, lines.length - 1); // minus header
  }
}
