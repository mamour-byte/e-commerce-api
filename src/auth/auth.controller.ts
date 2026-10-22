import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Get,
  Redirect,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SocialAuthDto } from './dto/social-auth.dto';
import { AppleCallbackDto } from './dto/apple-callback.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { SocialProvider } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.register(dto, { ipAddress, userAgent });
  }

  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, { ipAddress, userAgent });
  }

  @Post('refresh')
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refresh(dto.refreshToken, { ipAddress, userAgent });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  googleAuth(
    @Body() dto: SocialAuthDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.socialLogin(SocialProvider.GOOGLE, dto.idToken, {
      ipAddress,
      userAgent,
    });
  }

  /**
   * Step 1 — frontend calls this to start the Apple flow.
   * Sets an HttpOnly, Secure, SameSite=None cookie that binds the transaction
   * to this browser, then returns the state to include in the Apple redirect URL.
   */
  @Get('apple/initiate')
  @HttpCode(HttpStatus.OK)
  appleInitiate(@Res({ passthrough: true }) res: Response) {
    const { state, cookieValue } = this.authService.initiateApple();
    res.cookie('apple_tx', cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: 'none', // required: Apple's POST comes from a different origin
      maxAge: 10 * 60 * 1000,
      path: '/auth/apple/callback',
    });
    return { state };
  }

  /**
   * Step 2 — Apple POSTs here (form_post) after the user authenticates.
   * Verifies state + cookie, issues a session, stores it behind a transfer code,
   * then redirects the browser to the frontend with only the opaque code.
   */
  @Post('apple/callback')
  @Redirect()
  async appleCallback(
    @Body() dto: AppleCallbackDto,
    @Req() req: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const frontendUrl =
      process.env.FRONTEND_BROWSER_URL ??
      process.env.FRONTEND_URL ??
      'http://localhost:5173';
    const errorRedirect = { url: `${frontendUrl}/login?error=apple_failed`, statusCode: 302 };

    if (!dto.id_token || !dto.state) return errorRedirect;

    const cookieValue = (req.cookies as Record<string, string>)?.apple_tx;
    try {
      const redirectUrl = await this.authService.appleCallback(
        dto.id_token,
        dto.state,
        cookieValue,
        ipAddress,
        userAgent,
      );
      return { url: redirectUrl, statusCode: 302 };
    } catch {
      return errorRedirect;
    }
  }

  /**
   * Step 3 — frontend exchanges the short-lived opaque code for session tokens.
   */
  @Post('apple/exchange')
  @HttpCode(HttpStatus.OK)
  appleExchange(@Body('code') code: string) {
    if (!code) throw new UnauthorizedException('Missing code');
    return this.authService.exchangeAppleCode(code);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: unknown) {
    return user;
  }
}
