import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermission('organization:view')
  overview(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.overview(user, { from, to });
  }

  @Get('volume')
  @RequirePermission('organization:view')
  volume(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('period') period?: string,
  ) {
    return this.analytics.volume(user, { from, to, period });
  }

  @Get('top-senders')
  @RequirePermission('organization:view')
  topSenders(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.topSenders(user, { from, to });
  }

  @Get('top-domains')
  @RequirePermission('organization:view')
  topDomains(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.topDomains(user, { from, to });
  }

  @Get('busy-hours')
  @RequirePermission('organization:view')
  busyHours(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.busyHours(user, { from, to });
  }

  @Get('team-performance')
  @RequirePermission('organization:view')
  teamPerformance(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.teamPerformance(user, { from, to });
  }
}
