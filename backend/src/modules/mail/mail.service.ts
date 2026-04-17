import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { FeatureFlagsService } from '../../config/feature-flags.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
  ) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.config.get<string>('smtp.host');
    const port = this.config.get<number>('smtp.port') || 587;
    const user = this.config.get<string>('smtp.user');
    const pass = this.config.get<string>('smtp.pass');

    if (!host) {
      this.logger.warn('SMTP_HOST is not configured. Email sending will be disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(`DISABLE_SMTP_SEND active; skipping email to ${options.to}`);
      return false;
    }

    if (!this.transporter) {
      this.logger.error('Email transporter not initialized. Check SMTP configuration.');
      return false;
    }

    const from = this.config.get<string>('smtp.from') || 'noreply@sermuno.ai';

    try {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || '',
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}`, (error as Error).stack);
      return false;
    }
  }

  async sendVerificationEmail(email: string, token: string, fullName: string): Promise<boolean> {
    const frontendUrl = this.config.get<string>('frontend.url') || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

    return this.sendMail({
      to: email,
      subject: 'Verify your email for Sermuno',
      html: `
        <p>Hello ${fullName},</p>
        <p>Thank you for registering on Sermuno! Please verify your email by clicking the link below:</p>
        <p><a href="${verifyUrl}">Verify Email</a></p>
        <p>This link expires in 24 hours.</p>
      `,
      text: `Hello ${fullName},\n\nThank you for registering on Sermuno! Please verify your email by clicking the link below:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    });
  }

  async sendPasswordResetEmail(email: string, token: string, fullName: string): Promise<boolean> {
    const frontendUrl = this.config.get<string>('frontend.url') || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    return this.sendMail({
      to: email,
      subject: 'Reset your password for Sermuno',
      html: `
        <p>Hello ${fullName},</p>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <p><a href="${resetUrl}">Reset Password</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Hello ${fullName},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can ignore this email.`,
    });
  }

  async sendInviteEmail(options: {
    email: string;
    token: string;
    inviterName: string;
    organizationName: string;
    fullName?: string;
    role: string;
  }): Promise<boolean> {
    const frontendUrl = this.config.get<string>('frontend.url') || 'http://localhost:5173';
    const inviteUrl = `${frontendUrl}/invite/${encodeURIComponent(options.token)}`;
    const safeName = options.fullName || options.email;

    return this.sendMail({
      to: options.email,
      subject: `Invitation to join ${options.organizationName} on Sermuno`,
      html: `
        <p>Hello ${safeName},</p>
        <p>${options.inviterName} invited you to join <strong>${options.organizationName}</strong> as <strong>${options.role}</strong>.</p>
        <p><a href="${inviteUrl}">Accept your invitation</a></p>
        <p>This invite expires in 7 days.</p>
      `,
      text: `Hello ${safeName},\n\n${options.inviterName} invited you to join ${options.organizationName} as ${options.role}.\n\nAccept your invitation: ${inviteUrl}\n\nThis invite expires in 7 days.`,
    });
  }
}
