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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import {
  CreateContactDto,
  UpdateContactDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  UpdateContactNotificationPreferenceDto,
} from './dto/crm.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // ── Contacts ──────────────────────────────────────────────────────────────

  @Get('contacts')
  @RequirePermission('contacts:view')
  listContacts(@CurrentUser() user: JwtUser) {
    return this.crm.listContacts(user);
  }

  @Post('contacts')
  @RequirePermission('contacts:create')
  createContact(@Body() dto: CreateContactDto, @CurrentUser() user: JwtUser) {
    return this.crm.createContact(dto, user);
  }

  @Get('contacts/:id')
  @RequirePermission('contacts:view')
  getContact(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.crm.getContact(id, user);
  }

  @Patch('contacts/:id')
  @RequirePermission('contacts:manage')
  updateContact(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.crm.updateContact(id, dto, user);
  }

  @Delete('contacts/:id')
  @RequirePermission('contacts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteContact(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.crm.deleteContact(id, user);
  }

  @Get('contacts/:id/notification-preferences')
  @RequirePermission('contacts:view')
  getContactNotificationPreference(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.crm.getContactNotificationPreference(id, user);
  }

  @Patch('contacts/:id/notification-preferences')
  @RequirePermission('contacts:manage')
  updateContactNotificationPreference(
    @Param('id') id: string,
    @Body() dto: UpdateContactNotificationPreferenceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.crm.updateContactNotificationPreference(id, dto, user);
  }

  // ── Companies ─────────────────────────────────────────────────────────────

  @Get('companies')
  @RequirePermission('contacts:view')
  listCompanies(@CurrentUser() user: JwtUser) {
    return this.crm.listCompanies(user);
  }

  @Post('companies')
  @RequirePermission('contacts:create')
  createCompany(@Body() dto: CreateCompanyDto, @CurrentUser() user: JwtUser) {
    return this.crm.createCompany(dto, user);
  }

  @Get('companies/:id')
  @RequirePermission('contacts:view')
  getCompany(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.crm.getCompany(id, user);
  }

  @Patch('companies/:id')
  @RequirePermission('contacts:manage')
  updateCompany(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.crm.updateCompany(id, dto, user);
  }

  @Delete('companies/:id')
  @RequirePermission('contacts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCompany(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.crm.deleteCompany(id, user);
  }
}
