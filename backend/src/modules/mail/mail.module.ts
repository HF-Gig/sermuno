import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [ConfigModule, FeatureFlagsModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
