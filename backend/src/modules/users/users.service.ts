import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  InviteUserDto,
  UpdateMeDto,
  UpdateUserDto,
  UsersQueryDto,
} from './dto/user.dto';
import * as crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { FeatureFlagsService } from '../../config/feature-flags.service';

type UserStatus = 'active' | 'inactive' | 'invited' | 'deleted';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ─── List users ────────────────────────────────────────────────────────────

  async findAll(
    organizationId: string,
    query: UsersQueryDto = {},
  ): Promise<
    object[] | { items: object[]; total: number; page: number; limit: number }
  > {
    const now = new Date();
    const hasPagination = query.page !== undefined || query.limit !== undefined;
    const hasFilters = Boolean(
      query.search || query.role || query.status || query.teamId,
    );
    const where = this.buildUsersWhereInput(organizationId, query, now);

    const page = this.parsePositiveInt(query.page, 1);
    const limit = this.parsePositiveInt(query.limit, 25, 200);
    const skip = (page - 1) * limit;

    const select = {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      emailVerified: true,
      mfaEnabled: true,
      timezone: true,
      locale: true,
      avatarUrl: true,
      lastLogin: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      invitedByName: true,
      inviteToken: true,
      inviteExpiresAt: true,
      teamMemberships: {
        select: {
          teamId: true,
        },
      },
    } satisfies Prisma.UserSelect;

    if (!hasPagination && !hasFilters) {
      const users = await this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select,
      });
      return users.map((user) => this.mapUserResponse(user, now));
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        select,
      }),
    ]);

    return {
      items: users.map((user) => this.mapUserResponse(user, now)),
      total,
      page,
      limit,
    };
  }

  async findOne(organizationId: string, userId: string): Promise<object> {
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        emailVerified: true,
        mfaEnabled: true,
        timezone: true,
        locale: true,
        avatarUrl: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        invitedByName: true,
        inviteToken: true,
        inviteExpiresAt: true,
        teamMemberships: {
          select: {
            teamId: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.mapUserResponse(user, now);
  }

  // ─── Get invite info ──────────────────────────────────────────────────────

  async getInvite(token: string): Promise<object> {
    const user = await this.prisma.user.findFirst({
      where: {
        inviteToken: token,
        inviteExpiresAt: { gte: new Date() },
        deletedAt: null,
      },
      select: {
        email: true,
        fullName: true,
        role: true,
        invitedByName: true,
        organization: { select: { name: true, enforceMfa: true } },
      },
    });
    if (!user) throw new NotFoundException('Invite link invalid or expired');
    return {
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      inviterName: user.invitedByName,
      organizationName: user.organization.name,
      enforceMfa: user.organization.enforceMfa,
    };
  }

  // ─── Invite user ──────────────────────────────────────────────────────────

  async invite(
    actor: JwtUser,
    dto: InviteUserDto,
    meta: RequestMeta = {},
  ): Promise<object> {
    const email = this.normalizeEmail(dto.email);
    const inviterName = actor.email;
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing && existing.organizationId !== actor.organizationId) {
      throw new ConflictException(
        'A user with this email already belongs to another organization',
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const inviteData = {
      email,
      fullName: dto.fullName?.trim() || existing?.fullName || '',
      role: dto.role as UserRole,
      inviteToken: token,
      inviteExpiresAt: expiresAt,
      invitedByName: inviterName,
      isActive: false,
      emailVerified: false,
      deletedAt: null,
    };

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: inviteData,
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            inviteToken: true,
            inviteExpiresAt: true,
            createdAt: true,
          },
        })
      : await this.prisma.user.create({
          data: {
            ...inviteData,
            passwordHash: '',
            organizationId: actor.organizationId,
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            inviteToken: true,
            inviteExpiresAt: true,
            createdAt: true,
          },
        });

    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    });

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const inviteUrl = `${frontendUrl}/invite/${encodeURIComponent(token)}`;

    const emailSent = await this.sendInviteEmail({
      email,
      token,
      inviterName,
      organizationName: organization?.name ?? 'Sermuno',
      fullName: dto.fullName,
      role: dto.role,
    });

    const result = {
      ...user,
      status: 'pending',
      invitedBy: inviterName,
      inviteLink: inviteUrl,
      inviteUrl,
      emailSent,
    };

    await this.logAuditSafe({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action: 'USER_INVITED',
      entityType: 'user',
      entityId: user.id,
      newValue: {
        email,
        role: user.role,
        expiresAt,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (!existing) {
      await this.logAuditSafe({
        organizationId: actor.organizationId,
        userId: actor.sub,
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: user.id,
        newValue: {
          email,
          role: user.role,
          status: 'invited',
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    return result;
  }

  // ─── Pending invites ─────────────────────────────────────────────────────

  async findPendingInvites(organizationId: string): Promise<object[]> {
    const now = new Date();
    const invites = await this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        emailVerified: false,
        inviteToken: { not: null },
        inviteExpiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        invitedByName: true,
        createdAt: true,
        inviteExpiresAt: true,
      },
    });

    return invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedByName,
      inviteDate: invite.createdAt,
      expiresAt: invite.inviteExpiresAt,
      status: 'pending',
    }));
  }

  async resendInvite(
    actor: JwtUser,
    inviteId: string,
    meta: RequestMeta = {},
  ): Promise<object> {
    const invite = await this.prisma.user.findFirst({
      where: {
        id: inviteId,
        organizationId: actor.organizationId,
        deletedAt: null,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
      },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const inviterName = actor.email;

    await this.prisma.user.update({
      where: { id: invite.id },
      data: {
        inviteToken: token,
        inviteExpiresAt: expiresAt,
        invitedByName: inviterName,
        isActive: false,
      },
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    });

    const emailSent = await this.sendInviteEmail({
      email: invite.email,
      token,
      inviterName,
      organizationName: organization?.name ?? 'Sermuno',
      fullName: invite.fullName,
      role: invite.role,
    });

    await this.logAuditSafe({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action: 'USER_INVITED',
      entityType: 'user',
      entityId: invite.id,
      newValue: {
        email: invite.email,
        role: invite.role,
        expiresAt,
        resent: true,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: 'pending',
      expiresAt,
      emailSent,
    };
  }

  async revokeInvite(
    actor: JwtUser,
    inviteId: string,
    meta: RequestMeta = {},
  ): Promise<void> {
    const invite = await this.prisma.user.findFirst({
      where: {
        id: inviteId,
        organizationId: actor.organizationId,
        deletedAt: null,
        emailVerified: false,
        inviteToken: { not: null },
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!invite) throw new NotFoundException('Invite not found');

    await this.prisma.user.update({
      where: { id: invite.id },
      data: {
        inviteToken: null,
        inviteExpiresAt: null,
        isActive: false,
      },
    });

    await this.logAuditSafe({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action: 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: invite.id,
      previousValue: {
        email: invite.email,
        role: invite.role,
        isActive: invite.isActive,
        deletedAt: invite.deletedAt,
      },
      newValue: {
        email: invite.email,
        role: invite.role,
        isActive: false,
        revokedInvite: true,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private async sendInviteEmail(input: {
    email: string;
    token: string;
    inviterName: string;
    organizationName: string;
    fullName?: string;
    role: string;
  }): Promise<boolean> {
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[users] DISABLE_SMTP_SEND active; skipped invite email recipient=${input.email}`,
      );
      return false;
    }

    const host = this.config.get<string>('smtp.host') ?? '';
    const from = this.config.get<string>('smtp.from') ?? '';
    const port = this.config.get<number>('smtp.port') ?? 587;
    const user = this.config.get<string>('smtp.user') ?? '';
    const pass = this.config.get<string>('smtp.pass') ?? '';

    if (!host || !from) {
      this.logger.warn(
        `SMTP is not configured (SMTP_HOST/SMTP_FROM). Invite email skipped for ${input.email}.`,
      );
      return false;
    }

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const inviteUrl = `${frontendUrl}/invite/${encodeURIComponent(input.token)}`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    const safeName =
      input.fullName && input.fullName.trim().length > 0
        ? input.fullName
        : input.email;

    try {
      await transporter.sendMail({
        from,
        to: input.email,
        subject: `Invitation to join ${input.organizationName} on Sermuno`,
        html: `
          <p>Hello ${safeName},</p>
          <p>${input.inviterName} invited you to join <strong>${input.organizationName}</strong> as <strong>${input.role}</strong>.</p>
          <p><a href="${inviteUrl}">Accept your invitation</a></p>
          <p>This invite expires in 7 days.</p>
        `,
        text: `Hello ${safeName},\n\n${input.inviterName} invited you to join ${input.organizationName} as ${input.role}.\n\nAccept your invitation: ${inviteUrl}\n\nThis invite expires in 7 days.`,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send invite email to ${input.email}`,
        error as Error,
      );
      return false;
    }
  }

  // ─── Update own profile ───────────────────────────────────────────────────

  async updateMe(userId: string, dto: UpdateMeDto): Promise<object> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.preferences !== undefined && {
          preferences: dto.preferences as Prisma.InputJsonValue,
        }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        timezone: true,
        locale: true,
        avatarUrl: true,
        preferences: true,
        updatedAt: true,
      },
    });
    return updated;
  }

  // ─── Update user by id (admin/manager) ────────────────────────────────────

  async update(
    organizationId: string,
    targetId: string,
    actorId: string,
    actorRole: string,
    dto: UpdateUserDto,
    meta: RequestMeta = {},
  ): Promise<object> {
    // Allow lookup of soft-deleted users so they can be restored
    const user = await this.prisma.user.findFirst({
      where: { id: targetId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    // Only ADMIN can change roles
    if (dto.role && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only admins can change user roles');
    }

    const previous = {
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      timezone: user.timezone,
      locale: user.locale,
      deletedAt: user.deletedAt,
    };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.role !== undefined && { role: dto.role as UserRole }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        // When restoring an active user, also clear deletedAt
        ...(dto.isActive === true && { deletedAt: null }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        timezone: true,
        locale: true,
        updatedAt: true,
      },
    });

    await this.logAuditSafe({
      organizationId,
      userId: actorId,
      action: dto.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      entityType: 'user',
      entityId: updated.id,
      previousValue: previous,
      newValue: {
        fullName: updated.fullName,
        role: updated.role,
        isActive: updated.isActive,
        timezone: updated.timezone,
        locale: updated.locale,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  // ─── Soft delete ──────────────────────────────────────────────────────────

  async remove(
    organizationId: string,
    targetId: string,
    actorId: string,
    meta: RequestMeta = {},
  ): Promise<void> {
    if (targetId === actorId)
      throw new BadRequestException('You cannot delete your own account');

    const user = await this.prisma.user.findFirst({
      where: { id: targetId, organizationId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: targetId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.prisma.mailboxAccess.deleteMany({
      where: { userId: targetId },
    });

    await this.logAuditSafe({
      organizationId,
      userId: actorId,
      action: 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: targetId,
      previousValue: {
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        deletedAt: user.deletedAt,
      },
      newValue: {
        isActive: false,
        deletedAt: new Date().toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private parsePositiveInt(
    value: unknown,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER,
  ): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private deriveUserStatus(
    user: {
      deletedAt: Date | null;
      isActive: boolean;
      emailVerified: boolean;
      inviteToken: string | null;
      inviteExpiresAt: Date | null;
    },
    now: Date,
  ): UserStatus {
    if (user.deletedAt) {
      return 'deleted';
    }

    const hasValidInvite = Boolean(
      user.inviteToken &&
      !user.emailVerified &&
      user.inviteExpiresAt &&
      user.inviteExpiresAt > now,
    );
    if (hasValidInvite) {
      return 'invited';
    }

    return user.isActive ? 'active' : 'inactive';
  }

  private mapUserResponse(
    user: {
      id: string;
      email: string;
      fullName: string;
      role: UserRole;
      isActive: boolean;
      emailVerified: boolean;
      mfaEnabled: boolean;
      timezone: string;
      locale: string;
      avatarUrl: string | null;
      lastLogin: Date | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      invitedByName: string | null;
      inviteToken: string | null;
      inviteExpiresAt: Date | null;
      teamMemberships?: Array<{ teamId: string }>;
    },
    now: Date,
  ) {
    const status = this.deriveUserStatus(user, now);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      timezone: user.timezone,
      locale: user.locale,
      avatarUrl: user.avatarUrl,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      invitedByName: user.invitedByName,
      teamIds: user.teamMemberships?.map((member) => member.teamId) ?? [],
      status,
    };
  }

  private buildUsersWhereInput(
    organizationId: string,
    query: UsersQueryDto,
    now: Date,
  ): Prisma.UserWhereInput {
    const andClauses: Prisma.UserWhereInput[] = [{ organizationId }];

    if (!query.status || query.status !== 'deleted') {
      andClauses.push({ deletedAt: null });
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      andClauses.push({
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (query.role) {
      andClauses.push({ role: query.role as UserRole });
    }

    if (query.teamId) {
      andClauses.push({
        teamMemberships: {
          some: {
            teamId: query.teamId,
          },
        },
      });
    }

    if (query.status === 'active') {
      andClauses.push({
        isActive: true,
        emailVerified: true,
        inviteToken: null,
      });
    }

    if (query.status === 'invited') {
      andClauses.push({
        emailVerified: false,
        inviteToken: { not: null },
        inviteExpiresAt: { gt: now },
      });
    }

    if (query.status === 'inactive') {
      andClauses.push({
        OR: [
          {
            isActive: false,
            inviteToken: null,
          },
          {
            emailVerified: false,
            inviteToken: { not: null },
            inviteExpiresAt: { lte: now },
          },
        ],
      });
    }

    if (query.status === 'deleted') {
      andClauses.push({ deletedAt: { not: null } });
    }

    return { AND: andClauses };
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
  }): Promise<void> {
    try {
      await this.auditService.log(input);
    } catch (error) {
      this.logger.warn(
        `Failed to write user audit log for ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
