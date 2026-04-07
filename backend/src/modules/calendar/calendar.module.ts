import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { CalendarTemplatesService } from './calendar-templates.service';
import { CalendarSyncService } from './calendar-sync.service';
import { IcsGeneratorService } from './ics-generator.service';
import { VideoConferencingService } from './video-conferencing.service';
import { PrismaService } from '../../database/prisma.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WebsocketsModule } from '../websockets/websockets.module';
import { AuditModule } from '../audit/audit.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: NOTIFICATION_DISPATCH_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: (config.get<string>('jwt.expiresIn') ??
            '15m') as import('@nestjs/jwt').JwtSignOptions['expiresIn'],
        },
      }),
    }),
    forwardRef(() => NotificationsModule),
    WebsocketsModule,
    AuditModule,
    WebhooksModule,
  ],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    CalendarTemplatesService,
    CalendarSyncService,
    IcsGeneratorService,
    VideoConferencingService,
    PrismaService,
    {
      provide: 'NOTIFICATIONS_SERVICE',
      useExisting: NotificationsService,
    },
  ],
  exports: [CalendarService, CalendarTemplatesService],
})
export class CalendarModule {}
