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
import { SignaturesService } from './signatures.service';
import {
  CreateSignatureDto,
  UpdateSignatureDto,
  AssignSignatureDto,
} from './dto/signature.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Get('available')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  getAvailable(@CurrentUser() user: JwtUser) {
    return this.signaturesService.getAvailable(user);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.signaturesService.findAll(user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:create')
  create(@Body() dto: CreateSignatureDto, @CurrentUser() user: JwtUser) {
    return this.signaturesService.create(dto, user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.signaturesService.findOne(id, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSignatureDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.signaturesService.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.signaturesService.remove(id, user);
  }

  @Post(':id/assign')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:manage')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignSignatureDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.signaturesService.assign(id, dto, user);
  }

  @Post(':id/lock')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:manage')
  lock(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.signaturesService.lock(id, user);
  }
}
