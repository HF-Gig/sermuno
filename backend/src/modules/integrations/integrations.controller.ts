import {
  Controller,
  Get,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

@Controller('integrations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('status')
  @RequirePermission('settings:manage')
  getStatus(@CurrentUser() user: JwtUser) {
    return this.integrationsService.getStatus(user);
  }

  @Delete('zoom')
  @RequirePermission('settings:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteZoom(@CurrentUser() user: JwtUser) {
    await this.integrationsService.deleteZoom(user);
  }

  @Delete('caldav')
  @RequirePermission('settings:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCalDav(@CurrentUser() user: JwtUser) {
    await this.integrationsService.deleteCalDav(user);
  }
}
