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
  CreateSignaturePlaceholderDto,
  UpdateSignaturePlaceholderDto,
} from './dto/signature.dto';
import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const BUILT_IN_SIGNATURE_VARIABLES = [
  { token: '{{user_name}}', label: 'User Name', defaultValue: '' },
  { token: '{{user_title}}', label: 'User Title', defaultValue: '' },
  { token: '{{user_phone}}', label: 'User Phone', defaultValue: '' },
] as const;

type SignaturePlaceholder = {
  token: string;
  label: string;
  defaultValue: string;
  builtIn?: boolean;
};

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
    if (!this.canManageSignatures(user) && scope !== 'personal') {
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
    const customPlaceholders = await this.getCustomPlaceholders(user);
    const customPlaceholderMap = Object.fromEntries(
      customPlaceholders.map((entry) => [entry.token, entry.defaultValue || '']),
    );

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
          customPlaceholderMap,
        ),
        contentHtml: this.renderSignatureHtml(
          signature.contentHtml || signature.bodyHtml,
          userRecord,
          customPlaceholderMap,
        ),
      }));

    return rendered;
  }

  async listPlaceholders(user: JwtUser) {
    const custom = await this.getCustomPlaceholders(user);
    return [
      ...BUILT_IN_SIGNATURE_VARIABLES.map((entry) => ({
        ...entry,
        builtIn: true,
      })),
      ...custom.map((entry) => ({ ...entry, builtIn: false })),
    ];
  }

  async createPlaceholder(dto: CreateSignaturePlaceholderDto, user: JwtUser) {
    const token = this.normalizePlaceholderToken(dto.token);
    this.assertCustomPlaceholderToken(token);
    const placeholders = await this.getCustomPlaceholders(user);
    const duplicate = placeholders.some(
      (entry) => entry.token.toLowerCase() === token.toLowerCase(),
    );
    if (duplicate) {
      throw new BadRequestException('Placeholder already exists');
    }

    const next = [
      ...placeholders,
      {
        token,
        label: String(dto.label || token).trim(),
        defaultValue: String(dto.defaultValue || ''),
      },
    ];
    await this.saveCustomPlaceholders(user, next);
    return { token, label: String(dto.label || token).trim(), defaultValue: String(dto.defaultValue || ''), builtIn: false };
  }

  async updatePlaceholder(
    rawToken: string,
    dto: UpdateSignaturePlaceholderDto,
    user: JwtUser,
  ) {
    const token = this.normalizePlaceholderToken(rawToken);
    this.assertCustomPlaceholderToken(token);
    const placeholders = await this.getCustomPlaceholders(user);
    const index = placeholders.findIndex(
      (entry) => entry.token.toLowerCase() === token.toLowerCase(),
    );
    if (index < 0) {
      throw new NotFoundException('Placeholder not found');
    }
    const current = placeholders[index];
    placeholders[index] = {
      token: current.token,
      label: dto.label !== undefined ? String(dto.label).trim() : current.label,
      defaultValue:
        dto.defaultValue !== undefined
          ? String(dto.defaultValue)
          : current.defaultValue,
    };
    await this.saveCustomPlaceholders(user, placeholders);
    return { ...placeholders[index], builtIn: false };
  }

  async removePlaceholder(rawToken: string, user: JwtUser) {
    const token = this.normalizePlaceholderToken(rawToken);
    this.assertCustomPlaceholderToken(token);
    const placeholders = await this.getCustomPlaceholders(user);
    const next = placeholders.filter(
      (entry) => entry.token.toLowerCase() !== token.toLowerCase(),
    );
    if (next.length === placeholders.length) {
      throw new NotFoundException('Placeholder not found');
    }
    await this.saveCustomPlaceholders(user, next);
    return { ok: true };
  }

  async uploadSignatureImage(file: Express.Multer.File | undefined, user: JwtUser) {
    if (!file) {
      throw new BadRequestException('No image uploaded');
    }
    if (!String(file.mimetype || '').startsWith('image/')) {
      throw new BadRequestException('Only image uploads are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be 5MB or less');
    }

    const extension = extname(file.originalname || '') || '.png';
    const filename = `${randomUUID()}${extension}`;
    const directory = join(
      process.cwd(),
      'uploads',
      'signatures',
      user.organizationId,
    );
    await mkdir(directory, { recursive: true });
    const fullPath = join(directory, filename);
    await writeFile(fullPath, file.buffer);
    const relativeUrl = `/uploads/signatures/${user.organizationId}/${filename}`;

    return {
      url: relativeUrl,
      filename: file.originalname,
      contentType: file.mimetype,
      sizeBytes: file.size,
    };
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

    const mapped = Object.fromEntries(
      this.extractVariableTokens(html).map((token) => [token, token]),
    );
    return mapped as Prisma.InputJsonValue;
  }

  private renderSignatureHtml(
    html: string | null | undefined,
    userRecord: {
      fullName: string;
      preferences: Prisma.JsonValue | null;
    } | null,
    customPlaceholderMap: Record<string, string> = {},
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
      ...customPlaceholderMap,
    };

    return Object.entries(replacements).reduce(
      (acc, [token, value]) => acc.replaceAll(token, value),
      String(html || ''),
    );
  }

  private extractVariableTokens(html: string | null | undefined) {
    const input = String(html || '');
    const matches = input.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || [];
    return Array.from(
      new Set(matches.map((entry) => this.normalizePlaceholderToken(entry))),
    );
  }

  private normalizePlaceholderToken(input: string) {
    const trimmed = String(input || '').trim();
    const raw = trimmed
      .replace(/^\{\{\s*/, '')
      .replace(/\s*\}\}$/, '')
      .trim()
      .toLowerCase();
    if (!raw || !/^[a-z0-9_]+$/.test(raw)) {
      throw new BadRequestException(
        'Placeholder token must contain only letters, numbers, or underscores',
      );
    }
    return `{{${raw}}}`;
  }

  private assertCustomPlaceholderToken(token: string) {
    const isBuiltIn = BUILT_IN_SIGNATURE_VARIABLES.some(
      (entry) => entry.token === token,
    );
    if (isBuiltIn) {
      throw new BadRequestException(
        'Built-in placeholders cannot be modified',
      );
    }
  }

  private async getCustomPlaceholders(user: JwtUser): Promise<SignaturePlaceholder[]> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { notificationSettings: true },
    });
    const settings =
      organization?.notificationSettings &&
      typeof organization.notificationSettings === 'object' &&
      !Array.isArray(organization.notificationSettings)
        ? (organization.notificationSettings as Record<string, unknown>)
        : {};
    const rawList = Array.isArray(settings.signaturePlaceholders)
      ? settings.signaturePlaceholders
      : [];

    return rawList
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const candidate = entry as Record<string, unknown>;
        try {
          const token = this.normalizePlaceholderToken(
            String(candidate.token || ''),
          );
          if (
            BUILT_IN_SIGNATURE_VARIABLES.some(
              (builtIn) => builtIn.token === token,
            )
          ) {
            return null;
          }
          return {
            token,
            label: String(candidate.label || token).trim(),
            defaultValue: String(candidate.defaultValue || ''),
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SignaturePlaceholder => Boolean(entry));
  }

  private async saveCustomPlaceholders(
    user: JwtUser,
    placeholders: SignaturePlaceholder[],
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { notificationSettings: true },
    });
    const settings =
      organization?.notificationSettings &&
      typeof organization.notificationSettings === 'object' &&
      !Array.isArray(organization.notificationSettings)
        ? {
            ...(organization.notificationSettings as Record<string, unknown>),
          }
        : {};

    settings.signaturePlaceholders = placeholders.map((entry) => ({
      token: entry.token,
      label: entry.label || entry.token,
      defaultValue: entry.defaultValue || '',
    }));

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        notificationSettings: settings as Prisma.InputJsonValue,
      },
    });
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
