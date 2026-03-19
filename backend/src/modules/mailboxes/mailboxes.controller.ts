import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import {
  CreateMailboxDto,
  UpdateMailboxDto,
  CreateMailboxAccessDto,
  CreateFolderDto,
  TestConnectionDto,
} from './dto/mailbox.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('mailboxes')
export class MailboxesController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  // GET /mailboxes
  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.mailboxesService.findAll(user);
  }

  // GET /mailboxes/:id
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.findOne(id, user);
  }

  // GET /mailboxes/:id/health
  @Get(':id/health')
  getHealth(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.getHealth(id, user);
  }

  // GET /mailboxes/:id/unread-count
  @Get(':id/unread-count')
  getUnreadCount(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.getUnreadCount(id, user);
  }

  // POST /mailboxes
  @Post()
  create(@Body() dto: CreateMailboxDto, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.create(dto, user);
  }

  // POST /mailboxes/test-connection
  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  testConnection(@Body() dto: TestConnectionDto) {
    return this.mailboxesService.testConnection(dto);
  }

  // PATCH /mailboxes/:id
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMailboxDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.update(id, dto, user);
  }

  // DELETE /mailboxes/:id
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.remove(id, user);
  }

  // DELETE /mailboxes/:id/oauth
  @Delete(':id/oauth')
  @HttpCode(HttpStatus.OK)
  revokeOauth(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.revokeOauth(id, user);
  }

  // GET /mailboxes/:id/access
  @Get(':id/access')
  getAccess(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.getAccess(id, user);
  }

  // POST /mailboxes/:id/access
  @Post(':id/access')
  createAccess(
    @Param('id') id: string,
    @Body() dto: CreateMailboxAccessDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.createAccess(id, dto, user);
  }

  // DELETE /mailboxes/:id/access/:accessId
  @Delete(':id/access/:accessId')
  @HttpCode(HttpStatus.OK)
  revokeAccess(
    @Param('id') id: string,
    @Param('accessId') accessId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.revokeAccess(id, accessId, user);
  }

  // GET /mailboxes/:mailboxId/folders
  @Get(':mailboxId/folders')
  getFolders(
    @Param('mailboxId') mailboxId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.getFolders(mailboxId, user);
  }

  // POST /mailboxes/:mailboxId/folders
  @Post(':mailboxId/folders')
  createFolder(
    @Param('mailboxId') mailboxId: string,
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.createFolder(mailboxId, dto, user);
  }

  // DELETE /mailboxes/:mailboxId/folders/:id
  @Delete(':mailboxId/folders/:id')
  @HttpCode(HttpStatus.OK)
  deleteFolder(
    @Param('mailboxId') mailboxId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.mailboxesService.deleteFolder(mailboxId, id, user);
  }

  // POST /mailboxes/:id/sync
  @Post(':id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerSync(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.mailboxesService.triggerSync(id, user);
  }
}
