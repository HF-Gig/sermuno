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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { SignaturesService } from './signatures.service';
import {
  CreateSignatureDto,
  UpdateSignatureDto,
  AssignSignatureDto,
  CreateSignaturePlaceholderDto,
  UpdateSignaturePlaceholderDto,
} from './dto/signature.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';

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

  @Get('placeholders')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:view')
  listPlaceholders(@CurrentUser() user: JwtUser) {
    return this.signaturesService.listPlaceholders(user);
  }

  @Post('placeholders')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:create')
  createPlaceholder(
    @Body() dto: CreateSignaturePlaceholderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.signaturesService.createPlaceholder(dto, user);
  }

  @Patch('placeholders/:token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:create')
  updatePlaceholder(
    @Param('token') token: string,
    @Body() dto: UpdateSignaturePlaceholderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.signaturesService.updatePlaceholder(token, dto, user);
  }

  @Delete('placeholders/:token')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:create')
  removePlaceholder(@Param('token') token: string, @CurrentUser() user: JwtUser) {
    return this.signaturesService.removePlaceholder(token, user);
  }

  @Post('images/upload')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('signatures:create')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.signaturesService.uploadSignatureImage(file, user);
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
