import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { PrismaService } from '../../database/prisma.service';
import { WebsocketsModule } from '../websockets/websockets.module';
import { SlaModule } from '../sla/sla.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { CrmModule } from '../crm/crm.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    ConfigModule,
    WebsocketsModule,
    SlaModule,
    NotificationsModule,
    AuditModule,
    CrmModule,
    AttachmentsModule,
    MessagesModule,
  ],
  controllers: [ThreadsController],
  providers: [ThreadsService, PrismaService, FeatureFlagsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
