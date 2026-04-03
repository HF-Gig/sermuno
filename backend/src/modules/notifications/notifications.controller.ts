import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  UpdateNotificationSettingsDto,
  UpdateOrganizationNotificationSettingsDto,
  UpdateQuietHoursDto,
  PushTokenDto,
  RevokePushTokenDto,
} from './dto/notification.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.notificationsService.findAll(user);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.markRead(id, user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: JwtUser) {
    return this.notificationsService.markAllRead(user);
  }

  @Get('settings')
  @RequirePermission('organization:view')
  getSettings(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getSettings(user);
  }

  @Patch('settings')
  @RequirePermission('organization:view')
  updateSettings(
    @Body() dto: UpdateNotificationSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.notificationsService.updateSettings(dto, user);
  }

  @Get('quiet-hours')
  @RequirePermission('organization:view')
  getQuietHours(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getQuietHours(user);
  }

  @Patch('quiet-hours')
  @RequirePermission('organization:view')
  updateQuietHours(
    @Body() dto: UpdateQuietHoursDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.notificationsService.updateQuietHours(dto, user);
  }

  @Get('org-settings')
  @RequirePermission('settings:manage')
  getOrganizationSettings(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getOrganizationSettings(user);
  }

  @Patch('org-settings')
  @RequirePermission('settings:manage')
  updateOrganizationSettings(
    @Body() dto: UpdateOrganizationNotificationSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.notificationsService.updateOrganizationSettings(dto, user);
  }

  @Get('push/config')
  @RequirePermission('organization:view')
  getPushConfig(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getPushConfig(user);
  }

  @Get('push/registrations')
  @RequirePermission('organization:view')
  listPushRegistrations(@CurrentUser() user: JwtUser) {
    return this.notificationsService.listPushRegistrations(user);
  }

  @Post('push/register')
  @RequirePermission('organization:view')
  registerPush(@Body() dto: PushTokenDto, @CurrentUser() user: JwtUser) {
    return this.notificationsService.registerPush(dto, user);
  }

  @Post('push/revoke')
  @RequirePermission('organization:view')
  revokePush(@Body() dto: RevokePushTokenDto, @CurrentUser() user: JwtUser) {
    return this.notificationsService.revokePush(dto, user);
  }
}
