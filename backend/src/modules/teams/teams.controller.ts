import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import {
  CreateTeamDto,
  UpdateTeamDto,
  AddTeamMemberDto,
  UpdateTeamMemberDto,
} from './dto/team.dto';

@Controller('teams')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @RequirePermission('teams:view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.teamsService.findAll(user.organizationId);
  }

  @Get(':id')
  @RequirePermission('teams:view')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.teamsService.findOne(user.organizationId, id);
  }

  @Post()
  @RequirePermission('teams:create')
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user.organizationId, dto);
  }

  @Patch(':id')
  @RequirePermission('teams:manage')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('teams:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    await this.teamsService.remove(user.organizationId, id);
  }

  @Post(':teamId/members')
  @RequirePermission('teams:manage')
  addMember(
    @CurrentUser() user: JwtUser,
    @Param('teamId') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(user.organizationId, teamId, dto);
  }

  @Patch(':teamId/members/:userId')
  @RequirePermission('teams:manage')
  updateMember(
    @CurrentUser() user: JwtUser,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamsService.updateMember(
      user.organizationId,
      teamId,
      userId,
      dto,
    );
  }

  @Delete(':teamId/members/:userId')
  @RequirePermission('teams:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: JwtUser,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    await this.teamsService.removeMember(user.organizationId, teamId, userId);
  }
}
