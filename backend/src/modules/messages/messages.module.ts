import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AttachmentsModule } from '../attachments/attachments.module';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_SEND_QUEUE } from '../../jobs/queues/email-send.queue';
import { SCHEDULED_MESSAGES_QUEUE } from '../../jobs/queues/scheduled-messages.queue';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    AttachmentsModule,
    NotificationsModule,
    BullModule.registerQueue({ name: EMAIL_SEND_QUEUE }),
    BullModule.registerQueue({ name: SCHEDULED_MESSAGES_QUEUE }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, PrismaService],
  exports: [MessagesService],
})
export class MessagesModule {}
