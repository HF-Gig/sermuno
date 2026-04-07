import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../queues/notification-dispatch.queue';
import { PushNotificationsService } from '../../modules/notifications/push-notifications.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';

export interface NotificationDispatchJobData {
  notificationId?: string;
  organizationId?: string;
  userId?: string;
  channel: 'email' | 'push' | 'in_app';
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
}

@Processor(NOTIFICATION_DISPATCH_QUEUE, {
  concurrency: 10,
})
export class NotificationDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pushNotifications: PushNotificationsService,
    private readonly featureFlags: FeatureFlagsService,
  ) {
    super();
  }

  async process(job: Job<NotificationDispatchJobData>): Promise<void> {
    const {
      notificationId,
      channel,
      userId,
      to,
      subject,
      text,
      html,
      attachments,
    } = job.data;
    this.logger.log(
      `[notification-dispatch] Dispatching notification=${notificationId ?? 'direct-email'} channel=${channel}`,
    );

    try {
      let notification: {
        title: string;
        message: string | null;
        type: string;
        resourceId: string | null;
        data: unknown;
      } | null = null;

      if (notificationId) {
        notification = await this.prisma.notification.findUnique({
          where: { id: notificationId },
        });
        if (!notification) {
          this.logger.warn(
            `[notification-dispatch] Notification ${notificationId} not found`,
          );
          return;
        }
      }

      switch (channel) {
        case 'email':
          if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
            this.logger.warn(
              '[notification-dispatch] DISABLE_SMTP_SEND active; skipping email dispatch',
            );
            return;
          }
          if (notification) {
            await this.sendEmail({
              userId,
              subject: notification.title,
              text: notification.message ?? '',
            });
          } else {
            await this.sendEmail({
              to,
              subject: subject ?? '',
              text: text ?? '',
              html,
              attachments,
            });
          }
          break;
        case 'push':
          if (!this.featureFlags.isEnabled('ENABLE_PUSH_NOTIFICATIONS')) {
            this.logger.log(
              '[notification-dispatch] Push feature disabled; skipping push dispatch',
            );
            return;
          }
          if (
            !notification ||
            !notificationId ||
            !userId ||
            !job.data.organizationId
          ) {
            this.logger.warn(
              '[notification-dispatch] Missing notification, notificationId, userId, or organizationId for push dispatch',
            );
            return;
          }
          await this.pushNotifications.deliverToUser({
            userId,
            organizationId: job.data.organizationId,
            payload: {
              notificationId,
              title: notification.title,
              message: notification.message,
              type: notification.type ?? 'notification',
              resourceId: notification.resourceId ?? null,
              url: this.pushNotifications.resolveNotificationUrl(
                notification.type,
                notification.resourceId,
              ),
              data:
                notification.data && typeof notification.data === 'object'
                  ? (notification.data as Record<string, unknown>)
                  : undefined,
            },
          });
          break;
        default:
          return;
      }

      if (notificationId) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { sentAt: new Date() },
        });
      }
    } catch (err: unknown) {
      this.logger.error(
        `[notification-dispatch] Failed notification=${notificationId ?? 'direct-email'} channel=${channel}: ${String(err)}`,
      );
      if (notificationId) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            failedAt: new Date(),
            error: String(err),
          },
        });
      }
      throw err;
    }
  }

  private async sendEmail(params: {
    userId?: string;
    to?: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      content: string;
      contentType?: string;
    }>;
  }): Promise<void> {
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        '[notification-dispatch] DISABLE_SMTP_SEND active; sendEmail skipped',
      );
      return;
    }

    let recipient = params.to ?? null;
    if (!recipient && params.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true },
      });
      recipient = user?.email ?? null;
    }
    if (!recipient) {
      this.logger.warn(
        '[notification-dispatch] No recipient email for dispatch',
      );
      return;
    }

    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('smtp.host'),
      port: this.config.get<number>('smtp.port') ?? 587,
      auth: {
        user: this.config.get<string>('smtp.user'),
        pass: this.config.get<string>('smtp.pass'),
      },
    });

    await transporter.sendMail({
      from: this.config.get<string>('smtp.from'),
      to: recipient,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
      ...(params.attachments?.length
        ? { attachments: params.attachments }
        : {}),
    });
  }
}
