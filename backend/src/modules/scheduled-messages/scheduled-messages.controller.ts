import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ScheduledMessagesService } from './scheduled-messages.service';

@Controller('scheduled-messages')
@UseGuards(JwtAuthGuard)
export class ScheduledMessagesController {
  constructor(private readonly service: ScheduledMessagesService) {}

  @Post()
  create(
    @Body()
    body: {
      mailboxId: string;
      threadId?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      scheduledAt: string;
      rrule?: string;
      timezone?: string;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.create(body, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancel(id, user);
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body() body: { status?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.patchStatus(id, body?.status ?? '', user);
  }
}
