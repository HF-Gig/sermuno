import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ThreadsService } from './threads.service';
import {
  ListThreadsDto,
  ThreadInboxCountsDto,
  BulkUpdateThreadsDto,
  UpdateThreadDto,
  ComposeThreadDto,
  ReplyThreadDto,
  ForwardThreadDto,
  AssignThreadDto,
  CreateNoteDto,
  UpdateNoteDto,
  NoteMentionSuggestionsQueryDto,
  AddTagDto,
  SnoozeThreadDto,
  StarThreadDto,
} from './dto/thread.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { Request } from 'express';
import { extractRequestMeta } from '../../common/http/request-meta';
import type { Express } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('threads')
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  // GET /threads
  @Get()
  findAll(@Query() query: ListThreadsDto, @CurrentUser() user: JwtUser) {
    return this.threadsService.findAll(query, user);
  }

  // GET /threads/counts/inbox
  @Get('counts/inbox')
  inboxCounts(
    @Query() query: ThreadInboxCountsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.getInboxCounts(query, user);
  }

  // PATCH /threads (bulk update)
  @Patch()
  @HttpCode(HttpStatus.OK)
  bulkUpdate(
    @Body() dto: BulkUpdateThreadsDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.bulkUpdate(dto, user, extractRequestMeta(req));
  }

  // POST /threads/compose
  @Post('compose')
  compose(@Body() dto: ComposeThreadDto, @CurrentUser() user: JwtUser) {
    return this.threadsService.compose(dto, user);
  }

  @Post('compose-with-attachments')
  @UseInterceptors(FilesInterceptor('files'))
  composeWithAttachments(
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @CurrentUser() user: JwtUser,
  ) {
    const dto = this.parseMultipartComposeDto(body);
    return this.threadsService.compose(dto, user, files);
  }

  // GET /threads/:id/mention-suggestions
  @Get(':id/mention-suggestions')
  getNoteMentionSuggestions(
    @Param('id') id: string,
    @Query() query: NoteMentionSuggestionsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.getNoteMentionSuggestions(id, query, user);
  }

  // GET /threads/:id
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.threadsService.findOne(id, user);
  }

  // PATCH /threads/:id
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateThreadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.update(id, dto, user, extractRequestMeta(req));
  }

  // PATCH /threads/:id/star
  @Patch(':id/star')
  star(
    @Param('id') id: string,
    @Body() dto: StarThreadDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.star(id, dto.starred, user);
  }

  // POST /threads/:id/archive
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.archive(id, user, extractRequestMeta(req));
  }

  // POST /threads/:id/unarchive
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  unarchive(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.unarchive(id, user, extractRequestMeta(req));
  }

  // POST /threads/:id/reply
  @Post(':id/reply')
  reply(
    @Param('id') id: string,
    @Body() dto: ReplyThreadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.reply(id, dto, user, extractRequestMeta(req));
  }

  // POST /threads/:id/forward
  @Post(':id/forward')
  forward(
    @Param('id') id: string,
    @Body() dto: ForwardThreadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.forward(id, dto, user, extractRequestMeta(req));
  }

  // POST /threads/:id/assign
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignThreadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.assign(id, dto, user, extractRequestMeta(req));
  }

  // GET /threads/:id/notes
  @Get(':id/notes')
  getNotes(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.threadsService.getNotes(id, user);
  }

  // POST /threads/:id/notes
  @Post(':id/notes')
  createNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.createNote(id, dto, user, extractRequestMeta(req));
  }

  // PUT /threads/:id/notes/:noteId
  @Patch(':id/notes/:noteId')
  updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.updateNote(id, noteId, dto, user);
  }

  // DELETE /threads/:id/notes/:noteId
  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.OK)
  deleteNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.deleteNote(id, noteId, user);
  }

  private parseMultipartComposeDto(body: Record<string, unknown>): ComposeThreadDto {
    const mailboxId = String(body.mailboxId || '').trim();
    const subject = String(body.subject || '').trim();
    const to = this.parseEmailList(body.to);
    const cc = this.parseEmailList(body.cc);
    const bcc = this.parseEmailList(body.bcc);
    const bodyHtml = String(body.bodyHtml || '').trim();
    const bodyText = String(body.bodyText || '').trim();
    const rrule = String(body.rrule || '').trim();
    const scheduledAtRaw = String(body.scheduledAt || '').trim();

    if (!mailboxId) {
      throw new BadRequestException('mailboxId is required');
    }
    if (!subject) {
      throw new BadRequestException('subject is required');
    }
    if (to.length === 0) {
      throw new BadRequestException('at least one recipient is required');
    }

    const dto: ComposeThreadDto = {
      mailboxId,
      subject,
      to,
      ...(cc.length > 0 ? { cc } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      ...(bodyHtml ? { bodyHtml } : {}),
      ...(bodyText ? { bodyText } : {}),
      ...(rrule ? { rrule } : {}),
    };

    if (scheduledAtRaw) {
      const scheduledAt = new Date(scheduledAtRaw);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('scheduledAt must be a valid ISO date');
      }
      dto.scheduledAt = scheduledAt;
    }

    return dto;
  }

  private parseEmailList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
    }

    const raw = String(value || '').trim();
    if (!raw) return [];

    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0);
        }
      } catch {
        // Fall back to treating it as a single email if JSON parsing fails.
      }
    }

    return [raw];
  }

  // POST /threads/:id/tags
  @Post(':id/tags')
  addTag(
    @Param('id') id: string,
    @Body() dto: AddTagDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.addTag(
      id,
      dto.tagId,
      user,
      extractRequestMeta(req),
    );
  }

  // DELETE /threads/:id/tags/:tagId
  @Delete(':id/tags/:tagId')
  @HttpCode(HttpStatus.OK)
  removeTag(
    @Param('id') id: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.removeTag(
      id,
      tagId,
      user,
      extractRequestMeta(req),
    );
  }

  // POST /threads/:id/snooze
  @Post(':id/snooze')
  snoozeThread(
    @Param('id') id: string,
    @Body() dto: SnoozeThreadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.snoozeThread(
      id,
      new Date(dto.snoozedUntil),
      user,
      extractRequestMeta(req),
    );
  }

  // POST /threads/:id/unsnooze
  @Post(':id/unsnooze')
  unsnoozeThread(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.threadsService.unsnoozeThread(id, user, extractRequestMeta(req));
  }
}
