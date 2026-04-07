import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import {
  SetupOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import type { RequestMeta } from '../../common/http/request-meta';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getMe(organizationId: string): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async setup(
    organizationId: string,
    dto: SetupOrganizationDto,
    actorUserId?: string,
    meta: RequestMeta = {},
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // Only callable once (if name is already meaningfully set, reject)
    const defaultNames = ['My Organization', ''];
    if (org.name && !defaultNames.includes(org.name)) {
      throw new BadRequestException('Organization has already been set up');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: dto.name,
        defaultTimezone: dto.defaultTimezone,
        defaultLocale: dto.defaultLocale,
        emailFooter: dto.emailFooter,
        enforceMfa: dto.enforceMfa,
        logoUrl: dto.logoUrl,
      },
    });

    await this.logAuditSafe({
      organizationId,
      userId: actorUserId,
      action: 'SETTINGS_UPDATED',
      entityType: 'organization',
      entityId: organizationId,
      previousValue: {
        name: org.name,
        defaultTimezone: org.defaultTimezone,
        defaultLocale: org.defaultLocale,
        emailFooter: org.emailFooter,
        enforceMfa: org.enforceMfa,
        logoUrl: org.logoUrl,
      },
      newValue: {
        name: updated.name,
        defaultTimezone: updated.defaultTimezone,
        defaultLocale: updated.defaultLocale,
        emailFooter: updated.emailFooter,
        enforceMfa: updated.enforceMfa,
        logoUrl: updated.logoUrl,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
    actorUserId?: string,
    meta: RequestMeta = {},
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.defaultTimezone !== undefined && {
          defaultTimezone: dto.defaultTimezone,
        }),
        ...(dto.defaultLocale !== undefined && {
          defaultLocale: dto.defaultLocale,
        }),
        ...(dto.emailFooter !== undefined && { emailFooter: dto.emailFooter }),
        ...(dto.enforceMfa !== undefined && { enforceMfa: dto.enforceMfa }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.maxMailboxes !== undefined && {
          maxMailboxes: dto.maxMailboxes,
        }),
        ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
        ...(dto.maxStorageGb !== undefined && {
          maxStorageGb: dto.maxStorageGb,
        }),
      },
    });

    await this.logAuditSafe({
      organizationId,
      userId: actorUserId,
      action: 'SETTINGS_UPDATED',
      entityType: 'organization',
      entityId: organizationId,
      previousValue: {
        name: org.name,
        defaultTimezone: org.defaultTimezone,
        defaultLocale: org.defaultLocale,
        emailFooter: org.emailFooter,
        enforceMfa: org.enforceMfa,
        logoUrl: org.logoUrl,
        maxMailboxes: org.maxMailboxes,
        maxUsers: org.maxUsers,
        maxStorageGb: org.maxStorageGb,
      },
      newValue: {
        name: updated.name,
        defaultTimezone: updated.defaultTimezone,
        defaultLocale: updated.defaultLocale,
        emailFooter: updated.emailFooter,
        enforceMfa: updated.enforceMfa,
        logoUrl: updated.logoUrl,
        maxMailboxes: updated.maxMailboxes,
        maxUsers: updated.maxUsers,
        maxStorageGb: updated.maxStorageGb,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  private async logAuditSafe(input: {
    organizationId: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      await this.auditService.log(input);
    } catch (error) {
      this.logger.warn(
        `Failed to write organization audit log for ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
