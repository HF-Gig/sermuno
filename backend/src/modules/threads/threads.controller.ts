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
} from '@nestjs/common';
import { ThreadsService } from './threads.service';
import {
  ListThreadsDto,
  ThreadInboxCountsDto,
  BulkUpdateThreadsDto,
  UpdateThreadDto,
  ComposeThreadDto,
  ReplyThreadDto,
  AssignThreadDto,
  CreateNoteDto,
  UpdateNoteDto,
  AddTagDto,
  SnoozeThreadDto,
  StarThreadDto,
} from './dto/thread.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

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
  bulkUpdate(@Body() dto: BulkUpdateThreadsDto, @CurrentUser() user: JwtUser) {
    return this.threadsService.bulkUpdate(dto, user);
  }

  // POST /threads/compose
  @Post('compose')
  compose(@Body() dto: ComposeThreadDto, @CurrentUser() user: JwtUser) {
    return this.threadsService.compose(dto, user);
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
  ) {
    return this.threadsService.update(id, dto, user);
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
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.threadsService.archive(id, user);
  }

  // POST /threads/:id/unarchive
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  unarchive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.threadsService.unarchive(id, user);
  }

  // POST /threads/:id/reply
  @Post(':id/reply')
  reply(
    @Param('id') id: string,
    @Body() dto: ReplyThreadDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.reply(id, dto, user);
  }

  // POST /threads/:id/assign
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignThreadDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.assign(id, dto, user);
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
  ) {
    return this.threadsService.createNote(id, dto, user);
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

  // POST /threads/:id/tags
  @Post(':id/tags')
  addTag(
    @Param('id') id: string,
    @Body() dto: AddTagDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.addTag(id, dto.tagId, user);
  }

  // DELETE /threads/:id/tags/:tagId
  @Delete(':id/tags/:tagId')
  @HttpCode(HttpStatus.OK)
  removeTag(
    @Param('id') id: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.removeTag(id, tagId, user);
  }

  // POST /threads/:id/snooze
  @Post(':id/snooze')
  snoozeThread(
    @Param('id') id: string,
    @Body() dto: SnoozeThreadDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.threadsService.snoozeThread(
      id,
      new Date(dto.snoozedUntil),
      user,
    );
  }

  // POST /threads/:id/unsnooze
  @Post(':id/unsnooze')
  unsnoozeThread(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.threadsService.unsnoozeThread(id, user);
  }
}
