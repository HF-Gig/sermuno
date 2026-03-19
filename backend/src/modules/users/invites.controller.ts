import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import type { Request } from 'express';

@Controller('invites')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvitesController {
  constructor(private readonly usersService: UsersService) {}

  @Get('pending')
  @RequirePermission('users:view')
  pending(@CurrentUser() user: JwtUser) {
    return this.usersService.findPendingInvites(user.organizationId);
  }

  @Post(':inviteId/resend')
  @RequirePermission('users:create')
  resend(
    @CurrentUser() user: JwtUser,
    @Param('inviteId') inviteId: string,
    @Req() req: Request,
  ) {
    const userAgent = Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'];
    return this.usersService.resendInvite(user, inviteId, {
      ipAddress: req.ip,
      userAgent,
    });
  }

  @Delete(':inviteId')
  @RequirePermission('users:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: JwtUser,
    @Param('inviteId') inviteId: string,
    @Req() req: Request,
  ) {
    const userAgent = Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'];
    await this.usersService.revokeInvite(user, inviteId, {
      ipAddress: req.ip,
      userAgent,
    });
  }
}
