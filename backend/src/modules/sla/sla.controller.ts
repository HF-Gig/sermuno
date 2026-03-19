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
import { SlaService } from './sla.service';
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from './dto/sla.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('sla-policies')
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('sla_policies:view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.slaService.findAll(user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('sla_policies:create')
  create(@Body() dto: CreateSlaPolicyDto, @CurrentUser() user: JwtUser) {
    return this.slaService.create(dto, user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('sla_policies:view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.slaService.findOne(id, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('sla_policies:manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.slaService.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('sla_policies:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.slaService.remove(id, user);
  }
}
