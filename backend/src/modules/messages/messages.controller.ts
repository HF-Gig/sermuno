import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  StreamableFile,
  Req,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import {
  ListMessagesDto,
  BulkReadDto,
  MoveMessageDto,
  SendMessageDto,
} from './dto/message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { Request, Response } from 'express';
import { extractRequestMeta } from '../../common/http/request-meta';

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // GET /messages
  @Get()
  findAll(@Query() query: ListMessagesDto, @CurrentUser() user: JwtUser) {
    return this.messagesService.findAll(query, user);
  }

  // PATCH /messages (bulk read/unread)
  @Patch()
  @HttpCode(HttpStatus.OK)
  bulkRead(
    @Body() dto: BulkReadDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.messagesService.bulkRead(dto, user, extractRequestMeta(req));
  }

  // POST /messages/send
  @Post('send')
  send(@Body() dto: SendMessageDto, @CurrentUser() user: JwtUser) {
    return this.messagesService.send(dto, user);
  }

  // GET /messages/:id
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.messagesService.findOne(id, user);
  }

  // POST /messages/:id/move
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(
    @Param('id') id: string,
    @Body() dto: MoveMessageDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.messagesService.move(id, dto, user, extractRequestMeta(req));
  }

  // GET /messages/:id/attachments/:attachmentId/download
  @Get(':id/attachments/:attachmentId/download')
  async download(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    const { url } = await this.messagesService.getAttachmentDownloadLink(
      id,
      attachmentId,
      user,
    );
    return res.redirect(url);
  }

  // GET /messages/:id/attachments/:attachmentId/download-link
  @Get(':id/attachments/:attachmentId/download-link')
  getDownloadLink(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.messagesService.getAttachmentDownloadLink(
      id,
      attachmentId,
      user,
    );
  }

  // GET /messages/:id/attachments/:attachmentId/public-download
  @Get(':id/attachments/:attachmentId/public-download')
  getPublicDownload(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.messagesService.getPublicDownloadUrl(id, attachmentId, user);
  }
}
