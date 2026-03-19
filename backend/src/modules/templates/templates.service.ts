import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateTemplateDto,
  UpdateTemplateDto,
  RenderTemplateDto,
} from './dto/template.dto';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private hasPermission(user: JwtUser, permission: string) {
    return (
      user.permissions.includes('*') || user.permissions.includes(permission)
    );
  }

  private isAdmin(user: JwtUser) {
    return String(user.role || '').toUpperCase() === 'ADMIN';
  }

  private canManageTemplates(user: JwtUser) {
    return this.isAdmin(user) || this.hasPermission(user, 'templates:manage');
  }

  async findAll(user: JwtUser) {
    if (this.canManageTemplates(user)) {
      return this.prisma.emailTemplate.findMany({
        where: {
          organizationId: user.organizationId,
          deletedAt: null,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
    }

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);

    return this.prisma.emailTemplate.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { scope: 'organization' },
          { scope: 'personal', createdByUserId: user.sub },
          ...(teamIds.length
            ? [{ scope: 'team', teamId: { in: teamIds } }]
            : []),
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: JwtUser) {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');
    if (
      template.scope === 'personal' &&
      template.createdByUserId !== user.sub &&
      !this.canManageTemplates(user)
    ) {
      throw new ForbiddenException('Access denied');
    }
    return template;
  }

  async create(dto: CreateTemplateDto, user: JwtUser) {
    const scope = dto.scope ?? 'personal';
    if (!this.canManageTemplates(user) && scope !== 'personal') {
      throw new ForbiddenException(
        'Only managed template users can create organization or team templates',
      );
    }
    const bodyHtml = dto.bodyHtml ?? dto.body;
    if (!bodyHtml) {
      throw new BadRequestException('bodyHtml is required');
    }

    return this.prisma.emailTemplate.create({
      data: {
        organizationId: user.organizationId,
        createdByUserId: user.sub,
        teamId: scope === 'team' ? (dto.teamId ?? null) : null,
        name: dto.name,
        subject: dto.subject ?? null,
        bodyHtml,
        scope,
        variables: (dto.variables ??
          []) as import('@prisma/client').Prisma.InputJsonValue,
        category: dto.category ?? null,
        isFavorite: dto.isFavorite ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateTemplateDto, user: JwtUser) {
    await this.findOne(id, user);
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...((dto.bodyHtml !== undefined || dto.body !== undefined) && {
          bodyHtml: dto.bodyHtml ?? dto.body,
        }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.variables !== undefined && {
          variables:
            dto.variables as import('@prisma/client').Prisma.InputJsonValue,
        }),
        ...(dto.teamId !== undefined && { teamId: dto.teamId }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.isFavorite !== undefined && { isFavorite: dto.isFavorite }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string, user: JwtUser) {
    await this.findOne(id, user);
    await this.prisma.emailTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async render(id: string, dto: RenderTemplateDto, user: JwtUser) {
    const template = await this.findOne(id, user);

    // Increment usage counter (fire-and-forget)
    void this.prisma.emailTemplate
      .update({ where: { id }, data: { timesUsed: { increment: 1 } } })
      .catch(() => undefined);

    try {
      const compiledSubject = template.subject
        ? Handlebars.compile(template.subject)(dto.variables)
        : null;
      const compiledBody = Handlebars.compile(template.bodyHtml)(dto.variables);
      return {
        subject: compiledSubject,
        bodyHtml: compiledBody,
      };
    } catch (err) {
      throw new BadRequestException(
        `Template render failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
