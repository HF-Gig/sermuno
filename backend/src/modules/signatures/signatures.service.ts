import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateSignatureDto,
  UpdateSignatureDto,
  AssignSignatureDto,
} from './dto/signature.dto';
import { Prisma } from '@prisma/client';

const SUPPORTED_SIGNATURE_VARIABLES = [
  '{{user_name}}',
  '{{user_title}}',
  '{{user_phone}}',
];

@Injectable()
export class SignaturesService {
  constructor(private readonly prisma: PrismaService) {}

  private hasPermission(user: JwtUser, permission: string) {
    return (
      user.permissions.includes('*') || user.permissions.includes(permission)
    );
  }

  private isAdmin(user: JwtUser) {
    return String(user.role || '').toUpperCase() === 'ADMIN';
  }

  private canManageSignatures(user: JwtUser) {
    return this.isAdmin(user) || this.hasPermission(user, 'signatures:manage');
  }

  private canAccessAllMailboxes(user: JwtUser) {
    return (
      this.isAdmin(user) ||
      this.hasPermission(user, 'mailboxes:manage') ||
      this.hasPermission(user, 'organization:manage')
    );
  }

  async findAll(user: JwtUser) {
    if (this.canManageSignatures(user)) {
      return this.prisma.signature.findMany({
        where: {
          organizationId: user.organizationId,
          deletedAt: null,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
    }

    const teamIds = await this.getUserTeamIds(user.sub);

    return this.prisma.signature.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { scope: 'organization' },
          { scope: 'personal', ownerId: user.sub },
          ...(teamIds.length
            ? [{ scope: 'team', ownerType: 'team', ownerId: { in: teamIds } }]
            : []),
          { ownerType: 'user', ownerId: user.sub },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: JwtUser) {
    const sig = await this.prisma.signature.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!sig) throw new NotFoundException('Signature not found');

    const teamIds = await this.getUserTeamIds(user.sub);
    const canAccess =
      sig.scope === 'organization' ||
      (sig.scope === 'personal' && sig.ownerId === user.sub) ||
      (sig.scope === 'team' &&
        sig.ownerType === 'team' &&
        !!sig.ownerId &&
        teamIds.includes(sig.ownerId)) ||
      (sig.ownerType === 'user' && sig.ownerId === user.sub) ||
      this.canManageSignatures(user);

    if (!canAccess) {
      throw new ForbiddenException('Access denied');
    }

    return sig;
  }

  async create(dto: CreateSignatureDto, user: JwtUser) {
    const scope = dto.scope ?? 'personal';
    const html = dto.bodyHtml ?? dto.contentHtml;
    if (!html) {
      throw new BadRequestException('bodyHtml is required');
    }
    if (
      !this.canManageSignatures(user) &&
      scope !== 'personal'
    ) {
      throw new ForbiddenException(
        'Only signature managers can create organization or team signatures',
      );
    }

    return this.prisma.signature.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        bodyHtml: html,
        contentHtml: html,
        scope,
        ownerId: scope === 'personal' ? user.sub : null,
        ownerType:
          scope === 'team' ? 'team' : scope === 'personal' ? 'user' : null,
        isDefault: dto.isDefault ?? false,
        isLocked: false,
        variables: this.normalizeVariables(dto.variables, html),
        assignedMailboxIds: [] as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? 0,
        createdByUserId: user.sub,
      },
    });
  }

  async update(id: string, dto: UpdateSignatureDto, user: JwtUser) {
    const sig = await this.findOne(id, user);
    this.assertCanMutate(sig, user);

    const html = dto.bodyHtml ?? dto.contentHtml;

    return this.prisma.signature.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(html !== undefined && {
          bodyHtml: html,
          contentHtml: html,
          variables: this.normalizeVariables(dto.variables, html),
        }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string, user: JwtUser) {
    const sig = await this.findOne(id, user);
    this.assertCanMutate(sig, user);

    await this.prisma.signature.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async assign(id: string, dto: AssignSignatureDto, user: JwtUser) {
    const current = await this.findOne(id, user);
    if (!this.canManageSignatures(user)) {
      throw new ForbiddenException(
        'Only signature managers can assign signatures',
      );
    }
    if (dto.userId && dto.teamId) {
      throw new BadRequestException('Assign to a user or a team, not both');
    }

    const data: Prisma.SignatureUpdateInput = {
      ...(dto.mailboxId !== undefined && {
        assignedMailboxIds: dto.mailboxId
          ? ([dto.mailboxId] as Prisma.InputJsonValue)
          : ([] as Prisma.InputJsonValue),
      }),
      ...(dto.mailboxIds !== undefined && {
        assignedMailboxIds: dto.mailboxIds as Prisma.InputJsonValue,
      }),
    };

    if (dto.teamId !== undefined) {
      data.scope = 'team';
      data.ownerType = 'team';
      data.ownerId = dto.teamId || null;
    } else if (dto.userId !== undefined) {
      data.scope = 'personal';
      data.ownerType = 'user';
      data.ownerId = dto.userId || null;
    } else if (current.scope !== 'personal') {
      data.scope = 'organization';
      data.ownerType = null;
      data.ownerId = null;
    }

    return this.prisma.signature.update({ where: { id }, data });
  }

  async lock(id: string, user: JwtUser) {
    await this.findOne(id, user);
    if (!this.canManageSignatures(user)) {
      throw new ForbiddenException(
        'Only signature managers can lock signatures',
      );
    }
    return this.prisma.signature.update({
      where: { id },
      data: { isLocked: true },
    });
  }

  async getAvailable(user: JwtUser) {
    const teamIds = this.canManageSignatures(user)
      ? []
      : await this.getUserTeamIds(user.sub);
    const mailboxIds = this.canAccessAllMailboxes(user)
      ? await this.getOrganizationMailboxIds(user.organizationId)
      : await this.getAccessibleMailboxIds(user.sub, teamIds);
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { fullName: true, preferences: true },
    });

    const signatures = await this.prisma.signature.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { scope: 'organization' },
          { scope: 'personal', ownerId: user.sub },
          ...(teamIds.length
            ? [{ scope: 'team', ownerType: 'team', ownerId: { in: teamIds } }]
            : []),
          { ownerType: 'user', ownerId: user.sub },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    const rendered = signatures
      .filter((signature) => {
        const assignedMailboxIds = Array.isArray(signature.assignedMailboxIds)
          ? (signature.assignedMailboxIds as string[])
          : [];
        return (
          assignedMailboxIds.length === 0 ||
          assignedMailboxIds.some((mailboxId) => mailboxIds.includes(mailboxId))
        );
      })
      .map((signature) => ({
        ...signature,
        bodyHtml: this.renderSignatureHtml(
          signature.bodyHtml || signature.contentHtml,
          userRecord,
        ),
        contentHtml: this.renderSignatureHtml(
          signature.contentHtml || signature.bodyHtml,
          userRecord,
        ),
      }));

    return rendered;
  }

  private assertCanMutate(
    sig: { scope: string; ownerId: string | null; isLocked: boolean },
    user: JwtUser,
  ) {
    if (this.canManageSignatures(user)) {
      return;
    }
    if (sig.isLocked) {
      throw new ForbiddenException('This signature is locked');
    }
    if (sig.scope !== 'personal' || sig.ownerId !== user.sub) {
      throw new ForbiddenException(
        'You can only modify your own personal signatures',
      );
    }
  }

  private normalizeVariables(
    variables: Record<string, string> | undefined,
    html?: string | null,
  ) {
    if (variables && Object.keys(variables).length > 0) {
      return variables as Prisma.InputJsonValue;
    }

    const supported = SUPPORTED_SIGNATURE_VARIABLES.filter((token) =>
      String(html || '').includes(token),
    );
    const mapped = Object.fromEntries(supported.map((token) => [token, token]));
    return mapped as Prisma.InputJsonValue;
  }

  private renderSignatureHtml(
    html: string | null | undefined,
    userRecord: {
      fullName: string;
      preferences: Prisma.JsonValue | null;
    } | null,
  ) {
    const preferences =
      userRecord?.preferences &&
      typeof userRecord.preferences === 'object' &&
      !Array.isArray(userRecord.preferences)
        ? (userRecord.preferences as Record<string, unknown>)
        : {};
    const replacements: Record<string, string> = {
      '{{user_name}}': userRecord?.fullName || '',
      '{{user_title}}': String(
        preferences.user_title || preferences.title || '',
      ),
      '{{user_phone}}': String(
        preferences.user_phone || preferences.phone || '',
      ),
    };

    return Object.entries(replacements).reduce(
      (acc, [token, value]) => acc.replaceAll(token, value),
      String(html || ''),
    );
  }

  private async getUserTeamIds(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    return memberships.map((membership) => membership.teamId);
  }

  private async getAccessibleMailboxIds(userId: string, teamIds: string[]) {
    const accesses = await this.prisma.mailboxAccess.findMany({
      where: {
        OR: [
          { userId, canRead: true },
          ...(teamIds.length
            ? [{ teamId: { in: teamIds }, canRead: true }]
            : []),
        ],
      },
      select: { mailboxId: true },
    });
    return Array.from(new Set(accesses.map((entry) => entry.mailboxId)));
  }

  private async getOrganizationMailboxIds(organizationId: string) {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    });
    return mailboxes.map((mailbox) => mailbox.id);
  }
}
