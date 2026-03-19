import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? '',
      }),
    }),
    forwardRef(() => NotificationsModule),
  ],
  providers: [
    EventsGateway,
    PrismaService,
    {
      provide: 'EVENTS_GATEWAY',
      useExisting: EventsGateway,
    },
  ],
  exports: [EventsGateway, 'EVENTS_GATEWAY'],
})
export class WebsocketsModule {}
