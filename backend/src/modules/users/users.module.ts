import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitesController } from './invites.controller';
import { PrismaService } from '../../database/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [UsersService, PrismaService],
  controllers: [UsersController, InvitesController],
  exports: [UsersService],
})
export class UsersModule {}
