import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  BadRequestException,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { CalendarService } from './calendar.service';
import { CalendarTemplatesService } from './calendar-templates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { Request, Response } from 'express';
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar-event.dto';
import {
  CreateCalendarTemplateDto,
  CreateEventFromTemplateDto,
} from './dto/calendar-template.dto';
import { RsvpDto, IngestRsvpDto, SendInviteDto } from './dto/rsvp.dto';
import { extractRequestMeta } from '../../common/http/request-meta';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly templatesService: CalendarTemplatesService,
    private readonly config: ConfigService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Events
  // ──────────────────────────────────────────────────────────────────────────

  @Get('events')
  @RequirePermission('calendar:view')
  findAll(@CurrentUser() user: JwtUser) {
    return this.calendarService.findAll(user);
  }

  @Post('events')
  @RequirePermission('calendar:create')
  create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.calendarService.create(dto, user, extractRequestMeta(req));
  }

  @Get('events/:id')
  @RequirePermission('calendar:view')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.calendarService.findOne(id, user);
  }

  @Patch('events/:id')
  @RequirePermission('calendar:manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.update(id, dto, user);
  }

  @Delete('events/:id')
  @RequirePermission('calendar:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.calendarService.remove(id, user);
  }

  @Post('events/:id/invite')
  @RequirePermission('calendar:create')
  sendInvite(
    @Param('id') id: string,
    @Body() dto: SendInviteDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.calendarService.sendInvite(id, dto, user, extractRequestMeta(req));
  }

  @Get('events/:id/attendees')
  @RequirePermission('calendar:view')
  getAttendees(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.calendarService.getAttendees(id, user);
  }

  @Post('events/:id/rsvp')
  @RequirePermission('calendar:view')
  rsvp(
    @Param('id') id: string,
    @Body() dto: RsvpDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.rsvp(id, dto, user);
  }

  @Post('invite')
  @RequirePermission('calendar:create')
  sendInviteByBody(
    @Body() dto: SendInviteDto & { eventId: string },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.calendarService.sendInvite(
      dto.eventId,
      dto,
      user,
      extractRequestMeta(req),
    );
  }

  @Get('events/:id/rsvp/public')
  getRsvpPublic(@Param('id') id: string, @Query('token') token: string) {
    return this.calendarService.getRsvpPublic(id, token);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RSVP ingest (incoming iCal reply)
  // ──────────────────────────────────────────────────────────────────────────

  @Public()
  @Post('rsvp/ingest')
  ingestRsvp(
    @Body() dto: IngestRsvpDto,
    @Headers('x-rsvp-ingest-secret') providedSecret?: string,
  ) {
    const expectedSecret =
      this.config.get<string>('calendar.rsvpIngestSecret')?.trim() ?? '';

    if (!expectedSecret) {
      throw new BadRequestException(
        'RSVP ingest secret is not configured on the server',
      );
    }

    const provided = (providedSecret ?? '').trim();
    if (!provided) {
      throw new UnauthorizedException('Missing RSVP ingest secret');
    }

    const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    const isValid =
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer);
    if (!isValid) {
      throw new UnauthorizedException('Invalid RSVP ingest secret');
    }

    return this.calendarService.ingestRsvp(dto);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // iCal feed (public)
  // ──────────────────────────────────────────────────────────────────────────

  @Get('feed/:userId.ics')
  async getFeed(@Param('userId') userId: string, @Res() res: Response) {
    const ics = await this.calendarService.generateIcsFeed(userId);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    return res.send(ics);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Templates
  // ──────────────────────────────────────────────────────────────────────────

  @Get('templates')
  @RequirePermission('calendar:view')
  getTemplates(@CurrentUser() user: JwtUser) {
    return this.calendarService.getTemplates(user);
  }

  @Post('templates')
  @RequirePermission('calendar:create')
  createTemplate(
    @Body() dto: CreateCalendarTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.createTemplate(dto, user);
  }

  @Post('templates/:id/create-event')
  @RequirePermission('calendar:create')
  createEventFromTemplate(
    @Param('id') id: string,
    @Body() dto: CreateEventFromTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.createEventFromTemplate(
      id,
      dto.variables ?? {},
      user,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sync
  // ──────────────────────────────────────────────────────────────────────────

  @Post('sync/google')
  @RequirePermission('calendar:manage')
  syncGoogle(
    @Body() body: { accessToken?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.syncGoogle(user, body?.accessToken);
  }

  @Post('sync/microsoft')
  @RequirePermission('calendar:manage')
  syncMicrosoft(
    @Body() body: { accessToken: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.syncMicrosoft(body.accessToken, user);
  }

  @Post('sync/caldav')
  @RequirePermission('calendar:manage')
  syncCalDav(
    @Body()
    body: { calDavUrl?: string; username?: string; password?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.syncCalDav(
      body.calDavUrl,
      body.username,
      body.password,
      user,
    );
  }
}
