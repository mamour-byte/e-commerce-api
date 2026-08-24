import { Body, Controller, Headers, Ip, Post, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post('register')
	register(@Body() dto: RegisterDto, @Ip() ipAddress: string, @Headers('user-agent') userAgent?: string) {
		return this.authService.register(dto, { ipAddress, userAgent });
	}

	@Post('login')
	login(@Body() dto: LoginDto, @Ip() ipAddress: string, @Headers('user-agent') userAgent?: string) {
		return this.authService.login(dto, { ipAddress, userAgent });
	}

	@Post('refresh')
	refresh(@Body() dto: RefreshTokenDto, @Ip() ipAddress: string, @Headers('user-agent') userAgent?: string) {
		return this.authService.refresh(dto.refreshToken, { ipAddress, userAgent });
	}

	@Post('logout')
	@UseGuards(JwtAuthGuard)
	logout(@Body() dto: RefreshTokenDto) {
		return this.authService.logout(dto.refreshToken);
	}

	@Get('me')
	@UseGuards(JwtAuthGuard)
	me(@CurrentUser() user: unknown) {
		return user;
	}
}
