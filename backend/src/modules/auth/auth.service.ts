import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { Queue } from 'bullmq';
import {
  generateSecret as otpGenerateSecret,
  generateURI as otpGenerateURI,
  verifySync as otpVerifySync,
} from 'otplib';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  AcceptInviteDto,
  ChangePasswordDto,
  MfaEnableDto,
  MfaDisableDto,
  MfaVerifyLoginDto,
  FirebaseAuthDto,
} from './dto/auth.dto';
import { UserRole } from '@prisma/client';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';
import type { EmailSyncJobData } from '../../jobs/processors/email-sync.processor';

// Permissions per role
const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    'organization:view',
    'organization:create',
    'organization:manage',
    'organization:delete',
    'users:view',
    'users:create',
    'users:manage',
    'users:delete',
    'teams:view',
    'teams:create',
    'teams:manage',
    'teams:delete',
    'mailboxes:view',
    'mailboxes:create',
    'mailboxes:manage',
    'mailboxes:delete',
    'contacts:view',
    'contacts:create',
    'contacts:manage',
    'contacts:delete',
    'messages:view',
    'messages:create',
    'messages:manage',
    'messages:delete',
    'threads:view',
    'threads:create',
    'threads:manage',
    'threads:delete',
    'calendar:view',
    'calendar:create',
    'calendar:manage',
    'threads:notes',
    'tags:view',
    'tags:create',
    'tags:manage',
    'tags:delete',
    'tags:apply',
    'rules:view',
    'rules:create',
    'rules:manage',
    'rules:delete',
    'signatures:view',
    'signatures:create',
    'signatures:manage',
    'templates:view',
    'templates:create',
    'templates:manage',
    'templates:delete',
    'webhooks:view',
    'webhooks:create',
    'webhooks:manage',
    'webhooks:delete',
    'sla_policies:view',
    'sla_policies:create',
    'sla_policies:manage',
    'sla_policies:delete',
    'audit:view',
    'settings:view',
    'settings:manage',
  ],
  MANAGER: [
    'organization:view',
    'users:view',
    'users:create',
    'users:manage',
    'teams:view',
    'teams:create',
    'teams:manage',
    'mailboxes:view',
    'mailboxes:create',
    'mailboxes:manage',
    'contacts:view',
    'contacts:create',
    'contacts:manage',
    'contacts:delete',
    'messages:view',
    'messages:create',
    'messages:manage',
    'threads:view',
    'threads:create',
    'threads:manage',
    'calendar:view',
    'calendar:create',
    'calendar:manage',
    'threads:notes',
    'tags:view',
    'tags:create',
    'tags:manage',
    'tags:apply',
    'rules:view',
    'rules:create',
    'rules:manage',
    'rules:delete',
    'signatures:view',
    'signatures:create',
    'templates:view',
    'templates:create',
    'templates:manage',
    'templates:delete',
    'audit:view',
    'settings:view',
    'sla_policies:view',
  ],
  USER: [
    'organization:view',
    'mailboxes:view',
    'contacts:view',
    'messages:view',
    'messages:create',
    'threads:view',
    'threads:create',
    'calendar:view',
    'calendar:create',
    'calendar:manage',
    'threads:notes',
    'tags:view',
    'tags:apply',
    'signatures:view',
    'signatures:create',
    'templates:view',
    'templates:create',
    'settings:view',
  ],
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectQueue(EMAIL_SYNC_QUEUE)
    private readonly emailSyncQueue: Queue<EmailSyncJobData>,
  ) {}

  // ─── Encryption helpers ────────────────────────────────────────────────────

  private getEncryptionKey(): Buffer {
    const key = this.config.get<string>('encryption.key') ?? '';
    return Buffer.from(crypto.createHash('sha256').update(key).digest());
  }

  private getLegacyEncryptionKey(): Buffer {
    const key = this.config.get<string>('encryption.key') ?? '';
    return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  private encodeOAuthState(userId: string): string {
    return Buffer.from(this.encrypt(userId), 'utf8').toString('base64url');
  }

  private decodeOAuthState(state: string): string {
    try {
      const encrypted = Buffer.from(state, 'base64url').toString('utf8');
      return this.decrypt(encrypted);
    } catch {
      throw new BadRequestException('Invalid OAuth state');
    }
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(data: string): string {
    const [ivHex, tagHex, encHex] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getEncryptionKey(),
        iv,
      );
      decipher.setAuthTag(tag);
      return decipher.update(enc) + decipher.final('utf8');
    } catch {
      const legacyDecipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getLegacyEncryptionKey(),
        iv,
      );
      legacyDecipher.setAuthTag(tag);
      return legacyDecipher.update(enc) + legacyDecipher.final('utf8');
    }
  }

  // ─── Email ────────────────────────────────────────────────────────────────

  private async sendVerificationEmail(
    email: string,
    fullName: string | null,
    token: string,
  ): Promise<boolean> {
    const host = this.config.get<string>('smtp.host') ?? '';
    const from = this.config.get<string>('smtp.from') ?? '';
    const port = this.config.get<number>('smtp.port') ?? 587;
    const smtpUser = this.config.get<string>('smtp.user') ?? '';
    const pass = this.config.get<string>('smtp.pass') ?? '';

    if (!host || !from) {
      this.logger.warn(
        `SMTP is not configured (SMTP_HOST/SMTP_FROM). Verification email skipped for ${email}.`,
      );
      return false;
    }

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(smtpUser && pass ? { auth: { user: smtpUser, pass } } : {}),
    });

    const safeName =
      fullName && fullName.trim().length > 0 ? fullName : email;

    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: 'Verify your email address for Sermuno',
        html: `
          <p>Hello ${safeName},</p>
          <p>Thank you for signing up for Sermuno!</p>
          <p>Please verify your email address by clicking the link below:</p>
          <p><a href="${verifyUrl}">Verify Your Email</a></p>
          <p>This link expires in 24 hours.</p>
          <p>If you didn't create this account, you can safely ignore this email.</p>
        `,
        text: `Hello ${safeName},\n\nThank you for signing up for Sermuno!\n\nPlease verify your email address by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create this account, you can safely ignore this email.`,
      });
      this.logger.debug(`Verification email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}`,
        error as Error,
      );
      return false;
    }
  }

  private async sendPasswordResetEmail(
    email: string,
    fullName: string | null,
    token: string,
  ): Promise<boolean> {
    const host = this.config.get<string>('smtp.host') ?? '';
    const from = this.config.get<string>('smtp.from') ?? '';
    const port = this.config.get<number>('smtp.port') ?? 587;
    const smtpUser = this.config.get<string>('smtp.user') ?? '';
    const pass = this.config.get<string>('smtp.pass') ?? '';

    if (!host || !from) {
      this.logger.warn(
        `SMTP is not configured (SMTP_HOST/SMTP_FROM). Password reset email skipped for ${email}.`,
      );
      return false;
    }

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(smtpUser && pass ? { auth: { user: smtpUser, pass } } : {}),
    });

    const safeName =
      fullName && fullName.trim().length > 0 ? fullName : email;

    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: 'Reset your password for Sermuno',
        html: `
          <p>Hello ${safeName},</p>
          <p>We received a request to reset your password. Click the link below to create a new password:</p>
          <p><a href="${resetUrl}">Reset Your Password</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
        `,
        text: `Hello ${safeName},\n\nWe received a request to reset your password. Visit the link below to create a new password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.`,
      });
      this.logger.debug(`Password reset email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        error as Error,
      );
      return false;
    }
  }

  // ─── Token generation ──────────────────────────────────────────────────────

  private generateAccessToken(user: {
    id: string;
    email: string;
    organizationId: string;
    role: UserRole;
  }): string {
    const permissions = ROLE_PERMISSIONS[user.role] ?? [];
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        role: user.role,
        permissions,
        type: 'access',
      },
      {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: (this.config.get<string>('jwt.expiresIn') ??
          '7d') as import('@nestjs/jwt').JwtSignOptions['expiresIn'],
      },
    );
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private buildRefreshToken(userId: string): {
    token: string;
    jti: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    const jti = crypto.randomUUID();
    const token = this.jwtService.sign(
      { sub: userId, type: 'refresh', jti },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: (this.config.get<string>('jwt.refreshExpiresIn') ??
          '30d') as import('@nestjs/jwt').JwtSignOptions['expiresIn'],
      },
    );
    const decoded = this.jwtService.decode(token);
    if (!decoded?.exp) {
      throw new UnauthorizedException('Failed to issue refresh token');
    }

    return {
      token,
      jti,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(decoded.exp * 1000),
    };
  }

  private async persistRefreshToken(
    tokenData: {
      userId: string;
      jti: string;
      tokenHash: string;
      expiresAt: Date;
      ipAddress?: string;
      userAgent?: string;
    },
    prismaClient: any = this.prisma,
  ): Promise<void> {
    await prismaClient.refreshToken.create({
      data: {
        userId: tokenData.userId,
        jti: tokenData.jti,
        tokenHash: tokenData.tokenHash,
        expiresAt: tokenData.expiresAt,
        ipAddress: tokenData.ipAddress ?? null,
        userAgent: tokenData.userAgent ?? null,
      },
    });
  }

  private async issueRefreshToken(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    const tokenData = this.buildRefreshToken(userId);
    await this.persistRefreshToken(
      {
        userId,
        jti: tokenData.jti,
        tokenHash: tokenData.tokenHash,
        expiresAt: tokenData.expiresAt,
        ipAddress,
        userAgent,
      },
      this.prisma,
    );
    return tokenData.token;
  }

  // ─── Password validation ───────────────────────────────────────────────────

  async validatePassword(
    email: string,
    password: string,
  ): Promise<{
    id: string;
    email: string;
    organizationId: string;
    role: UserRole;
    mfaEnabled: boolean;
  } | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.deletedAt) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    return {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
    };
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  async register(
    dto: RegisterDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const org = await this.prisma.organization.create({
      data: { name: dto.organizationName ?? 'My Organization' },
    });

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        organizationId: org.id,
        role: UserRole.ADMIN,
        emailVerified: false,
        inviteToken: verificationToken,
        inviteExpiresAt: verificationExpiresAt,
      },
    });

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.issueRefreshToken(
      user.id,
      ipAddress,
      userAgent,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Send verification email
    this.sendVerificationEmail(user.email, user.fullName, verificationToken).catch(
      (error) => {
        this.logger.error('Failed to send verification email', error as Error);
      },
    );

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    accessToken?: string;
    refreshToken?: string;
    requiresMfa?: boolean;
    tempToken?: string;
    user?: object;
  }> {
    const creds = await this.validatePassword(dto.email, dto.password);
    if (!creds) throw new UnauthorizedException('Invalid credentials');

    if (creds.mfaEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: creds.id, type: 'mfa_pending' },
        {
          secret: this.config.get<string>('jwt.secret'),
          expiresIn: '5m' as import('@nestjs/jwt').JwtSignOptions['expiresIn'],
        },
      );
      return { requiresMfa: true, tempToken };
    }

    const user = await this.prisma.user.update({
      where: { id: creds.id },
      data: { lastLogin: new Date() },
    });

    const accessToken = this.generateAccessToken(creds);
    const refreshToken = await this.issueRefreshToken(
      creds.id,
      ipAddress,
      userAgent,
    );

    return { accessToken, refreshToken, user: this.sanitizeUser(user) };
  }

  async firebaseAuth(
    dto: FirebaseAuthDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    accessToken?: string;
    refreshToken?: string;
    requiresMfa?: boolean;
    tempToken?: string;
    user?: object;
  }> {
    const rawToken = dto.idToken ?? dto.token;
    if (!rawToken) {
      throw new BadRequestException('Missing token');
    }

    const payload = this.decodeJwtPayload(rawToken);
    const email =
      typeof payload['email'] === 'string'
        ? payload['email'].toLowerCase()
        : null;
    if (!email) {
      throw new UnauthorizedException('Invalid Firebase token');
    }

    const fullName =
      typeof payload['name'] === 'string' && payload['name'].trim().length > 0
        ? payload['name'].trim()
        : email.split('@')[0];
    const avatarUrl =
      typeof payload['picture'] === 'string' ? payload['picture'] : null;
    const method = dto.method ?? this.getFirebaseSignInProvider(payload);
    const intent = dto.intent ?? 'login';
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;

    let user = await this.prisma.user.findUnique({ where: { email } });
    let createdNewUser = false;

    if (!user) {
      if (intent === 'login') {
        throw new UnauthorizedException(
          'No account found for this Microsoft/Google email. Please sign up first.',
        );
      }

      const requestedOrgName = dto.organizationName?.trim();
      const org = await this.prisma.organization.create({
        data: {
          name:
            requestedOrgName && requestedOrgName.length > 0
              ? requestedOrgName
              : 'My Organization',
        },
      });

      const generatedPassword = crypto.randomBytes(24).toString('hex');
      const passwordHash = await bcrypt.hash(generatedPassword, rounds);

      user = await this.prisma.user.create({
        data: {
          organizationId: org.id,
          email,
          passwordHash,
          fullName,
          role: UserRole.ADMIN,
          emailVerified: true,
          provider: 'firebase',
          method,
          ...(avatarUrl && { avatarUrl }),
          lastLogin: new Date(),
        },
      });
      createdNewUser = true;
    } else {
      if (intent === 'register') {
        throw new ConflictException(
          'An account with this email already exists. Please sign in instead.',
        );
      }

      if (!user.isActive || user.deletedAt) {
        throw new UnauthorizedException('Account is inactive');
      }

      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLogin: new Date(),
          emailVerified: true,
          provider: 'firebase',
          method,
          ...(avatarUrl && { avatarUrl }),
        },
      });
    }

    if (user.mfaEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, type: 'mfa_pending' },
        {
          secret: this.config.get<string>('jwt.secret'),
          expiresIn: '5m' as import('@nestjs/jwt').JwtSignOptions['expiresIn'],
        },
      );
      return { requiresMfa: true, tempToken };
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.issueRefreshToken(
      user.id,
      ipAddress,
      userAgent,
    );
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true },
    });
    const needsSetup = this.requiresOrganizationSetup(organization?.name);

    return {
      accessToken,
      refreshToken,
      user: {
        ...this.sanitizeUser(user),
        needsSetup: createdNewUser || needsSetup,
      },
    };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(userId: string, refreshToken?: string): Promise<void> {
    const now = new Date();

    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          tokenHash,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
  }

  async listSessions(
    userId: string,
    currentRefreshToken?: string,
  ): Promise<
    Array<{
      id: string;
      createdAt: Date;
      expiresAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
      current: boolean;
    }>
  > {
    const now = new Date();
    const currentTokenHash = currentRefreshToken
      ? this.hashToken(currentRefreshToken)
      : null;

    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        tokenHash: true,
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session, index) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: currentTokenHash
        ? session.tokenHash === currentTokenHash
        : index === 0,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Session not found');
    }
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  async refresh(
    dto: RefreshTokenDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; type?: string; jti?: string };
    try {
      payload = this.jwtService.verify<{
        sub: string;
        type?: string;
        jti?: string;
      }>(dto.refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Invalid token type');
    }

    const now = new Date();
    const tokenHash = this.hashToken(dto.refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        jti: payload.jti,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive || user.deletedAt)
      throw new UnauthorizedException('User not found');

    const accessToken = this.generateAccessToken(user);
    const newRefreshTokenData = this.buildRefreshToken(user.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.persistRefreshToken(
        {
          userId: user.id,
          jti: newRefreshTokenData.jti,
          tokenHash: newRefreshTokenData.tokenHash,
          expiresAt: newRefreshTokenData.expiresAt,
          ipAddress,
          userAgent,
        },
        tx,
      );
    });

    return { accessToken, refreshToken: newRefreshTokenData.token };
  }

  // ─── Forgot / Reset password ───────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) return; // Silently ignore — don't leak user existence

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await this.prisma.user.update({
      where: { id: user.id },
      data: { inviteToken: token, inviteExpiresAt: expiresAt },
    });

    // Send password reset email
    this.sendPasswordResetEmail(user.email, user.fullName, token).catch(
      (error) => {
        this.logger.error('Failed to send password reset email', error as Error);
      },
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        inviteToken: dto.token,
        inviteExpiresAt: { gte: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.newPassword, rounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, inviteToken: null, inviteExpiresAt: null },
    });
  }

  // ─── Accept invite ────────────────────────────────────────────────────────

  async acceptInvite(
    dto: AcceptInviteDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const user = await this.prisma.user.findFirst({
      where: {
        inviteToken: dto.token,
        inviteExpiresAt: { gte: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invite link invalid or expired');

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        fullName: dto.fullName,
        inviteToken: null,
        inviteExpiresAt: null,
        emailVerified: true,
        isActive: true,
        lastLogin: new Date(),
      },
    });

    const accessToken = this.generateAccessToken(updated);
    const refreshToken = await this.issueRefreshToken(
      updated.id,
      ipAddress,
      userAgent,
    );

    return { accessToken, refreshToken, user: this.sanitizeUser(updated) };
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  async getMe(userId: string): Promise<object> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true },
    });
    return {
      ...this.sanitizeUser(user),
      needsSetup: this.requiresOrganizationSetup(organization?.name),
    };
  }

  // ─── Verify email ─────────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { inviteToken: token, inviteExpiresAt: { gte: new Date() } },
    });
    if (!user)
      throw new BadRequestException('Invalid or expired verification token');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, inviteToken: null, inviteExpiresAt: null },
    });
  }

  // ─── Change password ──────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.newPassword, rounds);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  // ─── MFA ──────────────────────────────────────────────────────────────────

  async mfaGenerate(
    userId: string,
  ): Promise<{ secret: string; qrCode: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const secret = otpGenerateSecret();
    const otpauthUrl = otpGenerateURI({
      issuer: 'Sermuno',
      label: user.email,
      secret,
    });

    // Store encrypted secret temporarily (not yet enabled)
    const encryptedSecret = this.encrypt(secret);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptedSecret },
    });

    return {
      secret,
      qrCode: `data:image/png;base64,${Buffer.from(otpauthUrl, 'utf8').toString('base64')}`,
    };
  }

  async mfaEnable(userId: string, dto: MfaEnableDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret)
      throw new BadRequestException(
        'MFA not generated — call /auth/mfa/generate first',
      );

    const secret = this.decrypt(user.mfaSecret);
    const valid = otpVerifySync({ token: dto.totp, secret });
    if (!valid) throw new BadRequestException('Invalid TOTP code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
  }

  async mfaDisable(userId: string, dto: MfaDisableDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled)
      throw new BadRequestException('MFA is not enabled');

    const secret = this.decrypt(user.mfaSecret!);
    const valid = otpVerifySync({ token: dto.totp, secret });
    if (!valid) throw new BadRequestException('Invalid TOTP code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
  }

  async mfaVerifyLogin(
    dto: MfaVerifyLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwtService.verify<{ sub: string; type?: string }>(
        dto.tempToken,
        {
          secret: this.config.get<string>('jwt.secret'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired temp token');
    }
    if (payload.type !== 'mfa_pending')
      throw new UnauthorizedException('Invalid token type');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret)
      throw new UnauthorizedException('MFA not configured');

    const secret = this.decrypt(user.mfaSecret);
    const valid = otpVerifySync({ token: dto.totp, secret });
    if (!valid) throw new BadRequestException('Invalid TOTP code');

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.issueRefreshToken(
      user.id,
      ipAddress,
      userAgent,
    );

    return { accessToken, refreshToken, user: this.sanitizeUser(updated) };
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────

  getGoogleConnectUrl(userId: string): string {
    const clientId = this.config.get<string>('google.clientId');
    const redirectUri = this.config.get<string>('google.redirectUri');
    const scopes = [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
      'openid',
      'email',
    ].join(' ');
    const state = this.encodeOAuthState(userId);
    return (
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&` +
      `response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`
    );
  }

  async handleGoogleCallback(
    code: string,
    state: string,
  ): Promise<{ url: string }> {
    const clientId = this.config.get<string>('google.clientId');
    const clientSecret = this.config.get<string>('google.clientSecret');
    const redirectUri = this.config.get<string>('google.redirectUri');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId ?? '',
        client_secret: clientSecret ?? '',
        redirect_uri: redirectUri ?? '',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new BadRequestException('Failed to exchange Google OAuth code');
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    const userId = this.decodeOAuthState(state);
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, email: true, fullName: true },
    });
    if (!actor) throw new BadRequestException('Invalid OAuth state');

    const meRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      {
        headers: { Authorization: `Bearer ${tokenJson.access_token ?? ''}` },
      },
    );

    let emailAddress = '';
    if (meRes.ok) {
      const meJson = (await meRes.json()) as { emailAddress?: string };
      emailAddress = meJson.emailAddress ?? '';
    }

    const encryptedAccessToken = tokenJson.access_token
      ? this.encrypt(tokenJson.access_token)
      : null;
    const encryptedRefreshToken = tokenJson.refresh_token
      ? this.encrypt(tokenJson.refresh_token)
      : null;
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000)
      : null;

    if (encryptedAccessToken) {
      const mailboxEmail = emailAddress || actor.email;
      const existing = await this.prisma.mailbox.findFirst({
        where: {
          organizationId: actor.organizationId,
          deletedAt: null,
          OR: [
            { email: mailboxEmail },
            { provider: 'GMAIL', oauthProvider: 'gmail' },
          ],
        },
        select: { id: true },
      });

      const data = {
        provider: 'GMAIL' as const,
        name: emailAddress || actor.fullName || 'Google Mailbox',
        email: mailboxEmail,
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        imapUser: mailboxEmail,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: mailboxEmail,
        oauthProvider: 'gmail',
        oauthAccessToken: encryptedAccessToken,
        ...(encryptedRefreshToken
          ? { oauthRefreshToken: encryptedRefreshToken }
          : {}),
        ...(expiresAt ? { oauthTokenExpiresAt: expiresAt } : {}),
        googleAccessToken: encryptedAccessToken,
        ...(encryptedRefreshToken
          ? { googleRefreshToken: encryptedRefreshToken }
          : {}),
        ...(expiresAt ? { googleTokenExpiresAt: expiresAt } : {}),
        syncStatus: 'PENDING' as const,
      };

      let mailboxId = existing?.id || '';
      if (existing) {
        const updated = await this.prisma.mailbox.update({
          where: { id: existing.id },
          data: { ...data, syncStatus: 'PENDING' as const },
        });
        mailboxId = updated.id;
      } else {
        const created = await this.prisma.mailbox.create({
          data: {
            organizationId: actor.organizationId,
            ...data,
          },
        });
        mailboxId = created.id;
      }

      if (mailboxId) {
        const streamingMode =
          this.config.get<boolean>('featureFlags.enableStreamingSync') ?? false;
        await this.emailSyncQueue.add(
          'sync',
          { mailboxId, organizationId: actor.organizationId, streamingMode },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
        );
      }
    }

    // Return redirect to frontend — mailbox linking is done client-side
    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    return {
      url: `${frontendUrl}/settings/organization?tab=mailboxes&success=true&oauth=google`,
    };
  }

  // ─── Microsoft OAuth ──────────────────────────────────────────────────────

  private getMicrosoftScopes(): string {
    return [
      'openid',
      'profile',
      'email',
      'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
    ].join(' ');
  }

  private getMicrosoftTenantPreference(): string {
    return (
      String(this.config.get<string>('microsoft.tenantId') ?? 'common')
        .trim()
        .toLowerCase() || 'common'
    );
  }

  private getMicrosoftTokenTenants(code: string): string[] {
    const preferred = this.getMicrosoftTenantPreference();
    const codeLooksConsumer = code.startsWith('M.');

    if (codeLooksConsumer) {
      const consumerFirst = ['consumers', 'common', 'organizations'];
      const merged =
        preferred && !consumerFirst.includes(preferred)
          ? [preferred, ...consumerFirst]
          : consumerFirst;
      return [...new Set(merged)];
    }

    return [...new Set([preferred, 'common', 'organizations', 'consumers'])];
  }

  private microsoftOauthEndpoint(
    tenant: string,
    kind: 'authorize' | 'token',
  ): string {
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${kind}`;
  }

  getMicrosoftConnectUrl(userId: string): string {
    const clientId = this.config.get<string>('microsoft.clientId');
    const redirectUri = String(
      this.config.get<string>('microsoft.redirectUri') ?? '',
    ).trim();
    const scopes = this.getMicrosoftScopes();
    const tenant = this.getMicrosoftTenantPreference();
    const state = this.encodeOAuthState(userId);
    return (
      `${this.microsoftOauthEndpoint(tenant, 'authorize')}?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&` +
      `response_type=code&scope=${encodeURIComponent(scopes)}&response_mode=query&prompt=consent&state=${encodeURIComponent(state)}`
    );
  }

  async handleMicrosoftCallback(
    code: string,
    state: string,
  ): Promise<{ url: string }> {
    const clientId = this.config.get<string>('microsoft.clientId');
    const clientSecret = this.config.get<string>('microsoft.clientSecret');
    const redirectUri = String(
      this.config.get<string>('microsoft.redirectUri') ?? '',
    ).trim();

    let tokenJson: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    } | null = null;
    const tokenErrors: string[] = [];

    for (const tenant of this.getMicrosoftTokenTenants(code)) {
      const tokenRes = await fetch(
        this.microsoftOauthEndpoint(tenant, 'token'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId ?? '',
            client_secret: clientSecret ?? '',
            redirect_uri: redirectUri ?? '',
            grant_type: 'authorization_code',
          }),
        },
      );

      if (tokenRes.ok) {
        tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          id_token?: string;
        };
        break;
      }

      const errorBody = await tokenRes.text();
      const summarizedError = `tenant=${tenant};status=${tokenRes.status};body=${errorBody.slice(0, 320)}`;
      tokenErrors.push(summarizedError);
      this.logger.warn(
        `[microsoft-oauth] token exchange failed: ${summarizedError}`,
      );
    }

    if (!tokenJson?.access_token) {
      const compactErrors =
        tokenErrors.join(' || ') || 'unknown_exchange_error';
      throw new BadRequestException(
        `Failed to exchange Microsoft OAuth code (${compactErrors})`,
      );
    }

    const userId = this.decodeOAuthState(state);
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, email: true, fullName: true },
    });
    if (!actor) throw new BadRequestException('Invalid OAuth state');

    let emailAddress = '';
    let displayName = 'Microsoft Mailbox';

    if (tokenJson.id_token) {
      try {
        const idClaims = this.decodeJwtPayload(tokenJson.id_token);
        emailAddress = String(
          idClaims['preferred_username'] ||
            idClaims['email'] ||
            idClaims['upn'] ||
            idClaims['unique_name'] ||
            '',
        ).toLowerCase();
        displayName = String(idClaims['name'] || displayName);
      } catch {
        this.logger.warn(
          '[microsoft-oauth] Unable to parse id_token claims for mailbox identity',
        );
      }
    }

    if (!emailAddress && tokenJson.access_token) {
      try {
        const accessClaims = this.decodeJwtPayload(tokenJson.access_token);
        emailAddress = String(
          accessClaims['preferred_username'] ||
            accessClaims['email'] ||
            accessClaims['upn'] ||
            accessClaims['unique_name'] ||
            '',
        ).toLowerCase();
        if (displayName === 'Microsoft Mailbox') {
          displayName = String(accessClaims['name'] || displayName);
        }
      } catch {
        this.logger.warn(
          '[microsoft-oauth] Unable to parse access token claims for mailbox identity',
        );
      }
    }

    const encryptedAccessToken = tokenJson.access_token
      ? this.encrypt(tokenJson.access_token)
      : null;
    const encryptedRefreshToken = tokenJson.refresh_token
      ? this.encrypt(tokenJson.refresh_token)
      : null;
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000)
      : null;

    if (encryptedAccessToken) {
      const mailboxEmail = String(
        emailAddress || actor.email || '',
      ).toLowerCase();
      const existing = await this.prisma.mailbox.findFirst({
        where: {
          organizationId: actor.organizationId,
          deletedAt: null,
          OR: [
            { email: mailboxEmail },
            { provider: 'OUTLOOK', oauthProvider: 'microsoft' },
          ],
        },
        select: { id: true },
      });

      const data = {
        provider: 'OUTLOOK' as const,
        name: displayName || actor.fullName || 'Microsoft Mailbox',
        email: mailboxEmail,
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        imapSecure: true,
        imapUser: mailboxEmail,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: mailboxEmail,
        oauthProvider: 'microsoft',
        oauthAccessToken: encryptedAccessToken,
        ...(encryptedRefreshToken
          ? { oauthRefreshToken: encryptedRefreshToken }
          : {}),
        ...(expiresAt ? { oauthTokenExpiresAt: expiresAt } : {}),
        syncStatus: 'PENDING' as const,
      };

      let mailboxId = existing?.id || '';
      if (existing) {
        const updated = await this.prisma.mailbox.update({
          where: { id: existing.id },
          data: { ...data, syncStatus: 'PENDING' as const },
        });
        mailboxId = updated.id;
      } else {
        const created = await this.prisma.mailbox.create({
          data: {
            organizationId: actor.organizationId,
            ...data,
          },
        });
        mailboxId = created.id;
      }

      if (mailboxId) {
        const streamingMode =
          this.config.get<boolean>('featureFlags.enableStreamingSync') ?? false;
        await this.emailSyncQueue.add(
          'sync',
          { mailboxId, organizationId: actor.organizationId, streamingMode },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
        );
      }
    }

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    return {
      url: `${frontendUrl}/settings/organization?tab=mailboxes&success=true&oauth=microsoft`,
    };
  }

  // ─── Zoom OAuth ───────────────────────────────────────────────────────────

  getZoomConnectUrl(userId: string): string {
    const clientId = String(
      this.config.get<string>('zoom.clientId') ?? '',
    ).trim();
    const redirectUri = String(
      this.config.get<string>('zoom.redirectUri') ?? '',
    ).trim();
    if (!clientId || !redirectUri) {
      throw new BadRequestException(
        'Zoom OAuth is not configured. Set ZOOM_CLIENT_ID and ZOOM_REDIRECT_URI.',
      );
    }
    const state = this.encodeOAuthState(userId);
    return (
      `https://zoom.us/oauth/authorize?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&` +
      `response_type=code&state=${encodeURIComponent(state)}`
    );
  }

  async handleZoomCallback(
    code: string,
    state: string,
  ): Promise<{ url: string }> {
    const userId = this.decodeOAuthState(state);
    const clientId = String(
      this.config.get<string>('zoom.clientId') ?? '',
    ).trim();
    const clientSecret = String(
      this.config.get<string>('zoom.clientSecret') ?? '',
    ).trim();
    const redirectUri = String(
      this.config.get<string>('zoom.redirectUri') ?? '',
    ).trim();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'Zoom OAuth is not fully configured. Set ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_REDIRECT_URI.',
      );
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );

    const tokenRes = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri ?? '',
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new BadRequestException('Failed to exchange Zoom OAuth code');
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // Store AES-256 encrypted tokens in user.preferences
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const prefs = (user?.preferences as Record<string, string> | null) ?? {};

    const updatedPrefs = {
      ...prefs,
      zoomAccessToken: this.encrypt(tokens.access_token),
      zoomRefreshToken: this.encrypt(tokens.refresh_token),
      zoomTokenExpiresAt: expiresAt,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: updatedPrefs },
    });

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    return {
      url: `${frontendUrl}/settings/organization?tab=integrations&success=true&oauth=zoom`,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private decodeJwtPayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length < 2) {
      throw new UnauthorizedException('Invalid Firebase token');
    }

    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }

  private getFirebaseSignInProvider(
    payload: Record<string, unknown>,
  ): 'google' | 'microsoft' {
    const firebase = payload['firebase'];
    if (typeof firebase === 'object' && firebase !== null) {
      const provider = (firebase as Record<string, unknown>)[
        'sign_in_provider'
      ];
      if (
        typeof provider === 'string' &&
        provider.toLowerCase().includes('microsoft')
      ) {
        return 'microsoft';
      }
    }
    return 'google';
  }

  private getPermissionsForRole(role: unknown): string[] {
    const normalizedRole = String(role ?? '').toUpperCase();
    return ROLE_PERMISSIONS[normalizedRole] ?? [];
  }

  private requiresOrganizationSetup(organizationName?: string | null): boolean {
    const normalized = (organizationName ?? '').trim();
    return (
      normalized.length === 0 || normalized.toLowerCase() === 'my organization'
    );
  }

  private sanitizeUser(user: any): object {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, mfaSecret, inviteToken, inviteExpiresAt, ...safe } =
      user;
    return {
      ...safe,
      permissions: this.getPermissionsForRole(safe.role),
    };
  }
}
