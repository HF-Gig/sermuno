import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import {
  CreateCheckoutDto,
  CreatePortalDto,
  UpdateBillingDetailsDto,
  ChangeSubscriptionDto,
  SyncCheckoutDto,
} from './dto/billing.dto';
import type { Request } from 'express';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('info')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  getInfo(@CurrentUser() user: JwtUser) {
    return this.billingService.getInfo(user.organizationId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  createCheckout(@CurrentUser() user: JwtUser, @Body() dto: CreateCheckoutDto) {
    return this.billingService.createCheckout(user.organizationId, dto);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  createPortal(@CurrentUser() user: JwtUser, @Body() dto: CreatePortalDto) {
    return this.billingService.createPortal(user.organizationId, dto);
  }

  @Patch('details')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  updateDetails(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateBillingDetailsDto,
  ) {
    return this.billingService.updateBillingDetails(user.organizationId, dto);
  }

  @Post('subscription/change')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  changeSubscription(
    @CurrentUser() user: JwtUser,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    return this.billingService.changeSubscription(user.organizationId, dto);
  }

  @Post('subscription/cancel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  cancelSubscription(@CurrentUser() user: JwtUser) {
    return this.billingService.cancelSubscription(user.organizationId);
  }

  @Post('subscription/resume')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  resumeSubscription(@CurrentUser() user: JwtUser) {
    return this.billingService.resumeSubscription(user.organizationId);
  }

  @Post('payment-method/portal')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  paymentMethodPortal(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreatePortalDto,
  ) {
    return this.billingService.createPaymentMethodPortal(
      user.organizationId,
      dto.returnUrl,
    );
  }

  @Post('checkout/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  syncCheckout(@CurrentUser() user: JwtUser, @Body() dto: SyncCheckoutDto) {
    return this.billingService.syncCheckout(user.organizationId, dto.sessionId);
  }

  @Get('invoices/:invoiceId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('organization:manage')
  getInvoiceDetails(
    @CurrentUser() user: JwtUser,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getInvoiceDetails(
      user.organizationId,
      invoiceId,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.billingService.handleWebhook(req);
  }
}
