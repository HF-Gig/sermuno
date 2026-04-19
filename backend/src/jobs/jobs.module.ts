import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullConfigService } from './bull-config.service';
import { PrismaService } from '../database/prisma.service';
import { SlaService } from '../modules/sla/sla.service';
import { CrmService } from '../modules/crm/crm.service';
import { AttachmentStorageService } from '../modules/attachments/attachment-storage.service';
import { AuditService } from '../modules/audit/audit.service';
import { WebsocketsModule } from '../modules/websockets/websockets.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { WebhooksModule } from '../modules/webhooks/webhooks.module';
import { RulesModule } from '../modules/rules/rules.module';
import { MessagesModule } from '../modules/messages/messages.module';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { AiCategorizationService } from '../modules/ai-categorization/ai-categorization.service';

import { EMAIL_SYNC_QUEUE } from './queues/email-sync.queue';
import { EMAIL_SEND_QUEUE } from './queues/email-send.queue';
import { SCHEDULED_MESSAGES_QUEUE } from './queues/scheduled-messages.queue';
import { ATTACHMENT_CLEANUP_QUEUE } from './queues/attachment-cleanup.queue';
import { SLA_CHECK_QUEUE } from './queues/sla-check.queue';
import { SNOOZE_WAKEUP_QUEUE } from './queues/snooze-wakeup.queue';
import { NOTIFICATION_DISPATCH_QUEUE } from './queues/notification-dispatch.queue';
import { NOTIFICATION_DIGEST_QUEUE } from './queues/notification-digest.queue';

import { EmailSyncProcessor } from './processors/email-sync.processor';
import { EmailSendProcessor } from './processors/email-send.processor';
import { ScheduledMessagesProcessor } from './processors/scheduled-messages.processor';
import { AttachmentCleanupProcessor } from './processors/attachment-cleanup.processor';
import { SlaCheckProcessor } from './processors/sla-check.processor';
import { SnoozeWakeupProcessor } from './processors/snooze-wakeup.processor';
import { NotificationDispatchProcessor } from './processors/notification-dispatch.processor';
import { NotificationDigestProcessor } from './processors/notification-digest.processor';
import { NotificationDigestScheduler } from './notification-digest.scheduler';

const QUEUE_NAMES = [
  EMAIL_SYNC_QUEUE,
  EMAIL_SEND_QUEUE,
  SCHEDULED_MESSAGES_QUEUE,
  ATTACHMENT_CLEANUP_QUEUE,
  SLA_CHECK_QUEUE,
  SNOOZE_WAKEUP_QUEUE,
  NOTIFICATION_DISPATCH_QUEUE,
  NOTIFICATION_DIGEST_QUEUE,
];

@Module({
  imports: [
    ConfigModule,
    WebsocketsModule,
    NotificationsModule,
    WebhooksModule,
    RulesModule,
    MessagesModule,
    BullModule.forRootAsync({
      useClass: BullConfigService,
    }),
    ...QUEUE_NAMES.map((name) =>
      BullModule.registerQueue({
        name,
        // 5 priority levels: 1=critical, 2=high, 3=normal, 4=low, 5=background
        defaultJobOptions: {
          priority: 3,
        },
      }),
    ),
  ],
  providers: [
    BullConfigService,
    ConfigService,
    PrismaService,
    SlaService,
    CrmService,
    AttachmentStorageService,
    AuditService,
    EmailSyncProcessor,
    EmailSendProcessor,
    ScheduledMessagesProcessor,
    AttachmentCleanupProcessor,
    SlaCheckProcessor,
    SnoozeWakeupProcessor,
    NotificationDispatchProcessor,
    NotificationDigestProcessor,
    NotificationDigestScheduler,
    FeatureFlagsService,
    AiCategorizationService,
  ],
  exports: [BullModule, BullConfigService],
})
export class JobsModule {}
