import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { QuietHoursService } from './quiet-hours.service';
import { PrismaService } from '../../database/prisma.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';
import { NOTIFICATION_DIGEST_QUEUE } from '../../jobs/queues/notification-digest.queue';
import { WebsocketsModule } from '../websockets/websockets.module';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_DISPATCH_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATION_DIGEST_QUEUE }),
    forwardRef(() => WebsocketsModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushNotificationsService,
    QuietHoursService,
    PrismaService,
    FeatureFlagsService,
  ],
  exports: [NotificationsService, PushNotificationsService, QuietHoursService],
})
export class NotificationsModule {}
