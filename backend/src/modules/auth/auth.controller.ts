import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  AcceptInviteDto,
  VerifyEmailDto,
  ChangePasswordDto,
  MfaEnableDto,
  MfaDisableDto,
  MfaVerifyLoginDto,
  LogoutDto,
  RevokeSessionDto,
  FirebaseAuthDto,
} from './dto/auth.dto';
import type { Request, Response } from 'express';

interface RequestWithUser extends Request {
  user?: JwtUser;
}

const normalizeOauthCode = (value?: string): string =>
  String(value ?? '').replace(/ /g, '+');

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip, req.headers['user-agent']);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  async firebase(@Body() dto: FirebaseAuthDto, @Req() req: Request) {
    return this.authService.firebaseAuth(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('oauth-login')
  @HttpCode(HttpStatus.OK)
  async oauthLogin(@Body() dto: FirebaseAuthDto, @Req() req: Request) {
    return this.authService.firebaseAuth(
      { ...dto, intent: 'login' },
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: JwtUser, @Body() dto: LogoutDto = {}) {
    await this.authService.logout(user.sub, dto.refreshToken);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async sessions(@CurrentUser() user: JwtUser, @Req() req: Request) {
    const refreshTokenHeader = req.headers['x-refresh-token'];
    const refreshToken = Array.isArray(refreshTokenHeader)
      ? refreshTokenHeader[0]
      : refreshTokenHeader;
    return this.authService.listSessions(user.sub, refreshToken);
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: JwtUser,
    @Body() dto: RevokeSessionDto,
  ) {
    await this.authService.revokeSession(user.sub, dto.sessionId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto, req.ip, req.headers['user-agent']);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
  }

  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    return this.authService.acceptInvite(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: JwtUser) {
    return this.authService.getMe(user.sub);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.sub, dto);
  }

  @Post('mfa/generate')
  @UseGuards(JwtAuthGuard)
  async mfaGenerate(@CurrentUser() user: JwtUser) {
    return this.authService.mfaGenerate(user.sub);
  }

  @Post('mfa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async mfaEnable(@CurrentUser() user: JwtUser, @Body() dto: MfaEnableDto) {
    await this.authService.mfaEnable(user.sub, dto);
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async mfaDisable(@CurrentUser() user: JwtUser, @Body() dto: MfaDisableDto) {
    await this.authService.mfaDisable(user.sub, dto);
  }

  @Post('mfa/verify-login')
  @HttpCode(HttpStatus.OK)
  async mfaVerifyLogin(@Body() dto: MfaVerifyLoginDto, @Req() req: Request) {
    return this.authService.mfaVerifyLogin(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('google/connect')
  @UseGuards(JwtAuthGuard)
  googleConnect(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const url = this.authService.getGoogleConnectUrl(user.sub);
    return res.redirect(url);
  }

  @Get('google/url')
  @UseGuards(JwtAuthGuard)
  googleUrl(@CurrentUser() user: JwtUser) {
    const url = this.authService.getGoogleConnectUrl(user.sub);
    return { url };
  }

  @Get('google/callback')
  async googleCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    const code = normalizeOauthCode(
      (req.query as Record<string, string>)['code'],
    );
    const state = (req.query as Record<string, string>)['state'];
    if (!code) return res.redirect('/settings/mailboxes?error=no_code');
    if (!state) return res.redirect('/settings/mailboxes?error=no_state');
    try {
      const result = await this.authService.handleGoogleCallback(code, state);
      return res.redirect(result.url);
    } catch {
      return res.redirect(
        '/settings/organization?tab=mailboxes&error=true&oauth=google',
      );
    }
  }

  @Get('microsoft/connect')
  @UseGuards(JwtAuthGuard)
  microsoftConnect(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const url = this.authService.getMicrosoftConnectUrl(user.sub);
    return res.redirect(url);
  }

  @Get('microsoft/url')
  @UseGuards(JwtAuthGuard)
  microsoftUrl(@CurrentUser() user: JwtUser) {
    const url = this.authService.getMicrosoftConnectUrl(user.sub);
    return { url };
  }

  @Get('microsoft/callback')
  async microsoftCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    const code = normalizeOauthCode(
      (req.query as Record<string, string>)['code'],
    );
    const state = (req.query as Record<string, string>)['state'];
    if (!code) return res.redirect('/settings/mailboxes?error=no_code');
    if (!state) return res.redirect('/settings/mailboxes?error=no_state');
    try {
      const result = await this.authService.handleMicrosoftCallback(
        code,
        state,
      );
      return res.redirect(result.url);
    } catch {
      return res.redirect(
        '/settings/organization?tab=mailboxes&error=true&oauth=microsoft',
      );
    }
  }

  @Get('zoom/connect')
  @UseGuards(JwtAuthGuard)
  zoomConnect(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const url = this.authService.getZoomConnectUrl(user.sub);
    return res.redirect(url);
  }

  @Get('zoom/url')
  @UseGuards(JwtAuthGuard)
  zoomUrl(@CurrentUser() user: JwtUser) {
    const url = this.authService.getZoomConnectUrl(user.sub);
    return { url };
  }

  @Get('zoom/callback')
  async zoomCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    const code = (req.query as Record<string, string>)['code'];
    const state = (req.query as Record<string, string>)['state'];
    if (!code)
      return res.redirect(
        '/settings/organization?tab=integrations&error=true&oauth=zoom',
      );
    if (!state)
      return res.redirect(
        '/settings/organization?tab=integrations&error=true&oauth=zoom',
      );
    try {
      const result = await this.authService.handleZoomCallback(code, state);
      return res.redirect(result.url);
    } catch {
      return res.redirect(
        '/settings/organization?tab=integrations&error=true&oauth=zoom',
      );
    }
  }
}
