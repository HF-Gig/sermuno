import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';
import { WebsocketsModule } from '../websockets/websockets.module';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsService } from '../../config/feature-flags.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_SYNC_QUEUE }),
    WebsocketsModule,
    AuditModule,
  ],
  controllers: [MailboxesController],
  providers: [MailboxesService, PrismaService, FeatureFlagsService],
  exports: [MailboxesService],
})
export class MailboxesModule {}
