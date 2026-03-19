import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as Handlebars from 'handlebars';
import type { CreateCalendarTemplateDto } from './dto/calendar-template.dto';
import { VideoConferencingService } from './video-conferencing.service';

@Injectable()
export class CalendarTemplatesService {
  private readonly logger = new Logger(CalendarTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly videoConf: VideoConferencingService,
  ) {}

  async findAll(organizationId: string) {
    return this.prisma.calendarTemplate.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    dto: CreateCalendarTemplateDto,
    organizationId: string,
    userId: string,
  ) {
    return this.prisma.calendarTemplate.create({
      data: {
        organizationId,
        createdByUserId: userId,
        name: dto.name,
        title: dto.title,
        description: dto.description ?? null,
        durationMinutes: dto.durationMinutes ?? 30,
        location: dto.location ?? null,
        meetingLink: dto.meetingLink ?? null,
        variableDefinitions: (dto.variableDefinitions ??
          []) as Prisma.InputJsonValue,
        requiredFields: (dto.requiredFields ?? []) as Prisma.InputJsonValue,
        invitationTemplate: dto.invitationTemplate ?? null,
        meetingProvider: dto.meetingProvider ?? null,
        scope: dto.scope ?? 'personal',
        teamId: dto.teamId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async createEventFromTemplate(
    templateId: string,
    variables: Record<string, string>,
    organizationId: string,
    organizerId: string,
    accessTokens?: { google?: string; zoom?: string; microsoft?: string },
  ) {
    const template = await this.prisma.calendarTemplate.findFirst({
      where: {
        id: templateId,
        organizationId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!template) throw new NotFoundException('Template not found');

    // Validate required fields
    const required = (template.requiredFields as string[] | null) ?? [];
    for (const field of required) {
      if (!variables[field]) {
        throw new BadRequestException(`Missing required variable: ${field}`);
      }
    }

    // Render invitation template
    let renderedDescription: string | null = null;
    if (template.invitationTemplate) {
      try {
        const compiled = Handlebars.compile(template.invitationTemplate);
        renderedDescription = compiled(variables);
      } catch (err) {
        this.logger.warn(
          `[templates] Handlebars render failed: ${String(err)}`,
        );
      }
    }

    // Calculate start/end from now + durationMinutes
    const startTime = new Date();
    const endTime = new Date(
      startTime.getTime() + template.durationMinutes * 60 * 1000,
    );

    let meetingLink: string | null = template.meetingLink ?? null;
    let meetingProvider: string | null = template.meetingProvider ?? null;
    let meetingId: string | null = null;
    let meetingPassword: string | null = null;

    // Auto-create meeting if provider is set and we have a token
    if (template.meetingProvider && accessTokens) {
      try {
        if (template.meetingProvider === 'google_meet' && accessTokens.google) {
          const result = await this.videoConf.createGoogleMeet(
            accessTokens.google,
            template.title,
            startTime,
            endTime,
          );
          meetingLink = result.meetingLink;
          meetingProvider = result.meetingProvider;
          meetingId = result.meetingId ?? null;
        } else if (template.meetingProvider === 'zoom' && accessTokens.zoom) {
          const result = await this.videoConf.createZoomMeeting(
            accessTokens.zoom,
            template.title,
            startTime,
            template.durationMinutes,
          );
          meetingLink = result.meetingLink;
          meetingProvider = result.meetingProvider;
          meetingId = result.meetingId ?? null;
          meetingPassword = result.meetingPassword ?? null;
        } else if (
          template.meetingProvider === 'microsoft_teams' &&
          accessTokens.microsoft
        ) {
          const result = await this.videoConf.createTeamsMeeting(
            accessTokens.microsoft,
            template.title,
            startTime,
            endTime,
          );
          meetingLink = result.meetingLink;
          meetingProvider = result.meetingProvider;
          meetingId = result.meetingId ?? null;
        }
      } catch (err) {
        this.logger.warn(
          `[templates] Video conf create failed: ${String(err)}`,
        );
      }
    }

    // Apply variable substitution to the title too
    let title = template.title;
    try {
      title = Handlebars.compile(template.title)(variables);
    } catch {
      // keep original
    }

    const event = await this.prisma.event.create({
      data: {
        organization: { connect: { id: organizationId } },
        organizer: { connect: { id: organizerId } },
        title,
        description: renderedDescription ?? template.description ?? null,
        startTime,
        endTime,
        location: template.location ?? null,
        meetingLink,
        meetingProvider,
        meetingId,
        meetingPassword,
        templateId,
        status: 'confirmed',
        visibility: 'default',
        allDay: false,
      },
    });

    return event;
  }
}
