import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { TeamsModule } from './modules/teams/teams.module';
import { BillingModule } from './modules/billing/billing.module';
import { JobsModule } from './jobs/jobs.module';
import { MailboxesModule } from './modules/mailboxes/mailboxes.module';
import { ThreadsModule } from './modules/threads/threads.module';
import { MessagesModule } from './modules/messages/messages.module';
import { TagsModule } from './modules/tags/tags.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { RulesModule } from './modules/rules/rules.module';
import { SlaModule } from './modules/sla/sla.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebsocketsModule } from './modules/websockets/websockets.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { CrmModule } from './modules/crm/crm.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExportImportModule } from './modules/export-import/export-import.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { ScheduledMessagesModule } from './modules/scheduled-messages/scheduled-messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: seconds(parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10)),
          limit: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
        },
      ],
    }),
    JobsModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    TeamsModule,
    BillingModule,
    MailboxesModule,
    ThreadsModule,
    MessagesModule,
    TagsModule,
    SignaturesModule,
    TemplatesModule,
    RulesModule,
    SlaModule,
    NotificationsModule,
    WebsocketsModule,
    CalendarModule,
    IntegrationsModule,
    CrmModule,
    WebhooksModule,
    AnalyticsModule,
    AuditModule,
    ExportImportModule,
    AttachmentsModule,
    FeatureFlagsModule,
    ScheduledMessagesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
