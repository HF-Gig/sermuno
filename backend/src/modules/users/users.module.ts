import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitesController } from './invites.controller';
import { PrismaService } from '../../database/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsService } from '../../config/feature-flags.service';

@Module({
  imports: [AuditModule],
  providers: [UsersService, PrismaService, FeatureFlagsService],
  controllers: [UsersController, InvitesController],
  exports: [UsersService],
})
export class UsersModule {}
