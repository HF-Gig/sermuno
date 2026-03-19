import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { QuietHoursService } from './quiet-hours.service';
import { PrismaService } from '../../database/prisma.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';
import { WebsocketsModule } from '../websockets/websockets.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_DISPATCH_QUEUE }),
    forwardRef(() => WebsocketsModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    QuietHoursService,
    PrismaService,
    FeatureFlagsService,
  ],
  exports: [NotificationsService, QuietHoursService],
})
export class NotificationsModule {}
