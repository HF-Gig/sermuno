import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // ── Authenticated CRUD ─────────────────────────────────────────────────

  @RequirePermission('webhooks:view')
  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.webhooks.list(user);
  }

  @RequirePermission('webhooks:create')
  @Post()
  create(@Body() dto: CreateWebhookDto, @CurrentUser() user: JwtUser) {
    return this.webhooks.create(dto, user);
  }

  @RequirePermission('webhooks:view')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.webhooks.findOne(id, user);
  }

  @RequirePermission('webhooks:manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.webhooks.update(id, dto, user);
  }

  @RequirePermission('webhooks:delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.webhooks.remove(id, user);
  }

  // ── Incoming (public) ──────────────────────────────────────────────────

  @Post('incoming/:organizationId')
  @HttpCode(HttpStatus.OK)
  async handleIncoming(
    @Param('organizationId') organizationId: string,
    @Headers('x-sermuno-signature') signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    const rawBody = JSON.stringify(payload);
    return this.webhooks.handleIncoming(
      organizationId,
      rawBody,
      signature,
      payload,
    );
  }
}
