import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}), // secrets provided per-call in service
    BullModule.registerQueue({ name: EMAIL_SYNC_QUEUE }),
    MailModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    PrismaService,
    FeatureFlagsService,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
