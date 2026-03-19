import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import {
  SetupOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtUser) {
    return this.organizationsService.getMe(user.organizationId);
  }

  @Post('setup')
  @UseGuards(RolesGuard)
  @Roles('admin')
  setup(@CurrentUser() user: JwtUser, @Body() dto: SetupOrganizationDto) {
    return this.organizationsService.setup(user.organizationId, dto);
  }

  @Patch('me')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@CurrentUser() user: JwtUser, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(user.organizationId, dto);
  }
}
