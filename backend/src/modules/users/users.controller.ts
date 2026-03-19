import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
import {
  InviteUserDto,
  UpdateMeDto,
  UpdateUserDto,
  UsersQueryDto,
} from './dto/user.dto';
import type { Request } from 'express';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users:view')
  findAll(@CurrentUser() user: JwtUser, @Query() query: UsersQueryDto) {
    return this.usersService.findAll(user.organizationId, query);
  }

  @Get('invite/:token')
  getInvite(@Param('token') token: string) {
    return this.usersService.getInvite(token);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users:view')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.usersService.findOne(user.organizationId, id);
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users:create')
  invite(
    @CurrentUser() user: JwtUser,
    @Body() dto: InviteUserDto,
    @Req() req: Request,
  ) {
    const userAgent = Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'];
    return this.usersService.invite(user, dto, {
      ipAddress: req.ip,
      userAgent,
    });
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: JwtUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users:manage')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const userAgent = Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'];
    return this.usersService.update(
      user.organizationId,
      id,
      user.sub,
      user.role,
      dto,
      {
        ipAddress: req.ip,
        userAgent,
      },
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('users:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const userAgent = Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'];
    await this.usersService.remove(user.organizationId, id, user.sub, {
      ipAddress: req.ip,
      userAgent,
    });
  }
}
