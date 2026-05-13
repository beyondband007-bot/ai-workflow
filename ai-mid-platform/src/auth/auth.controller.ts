import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth-user.interface';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type UploadedAvatarFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Controller()
export class AuthController {
  private readonly refreshCookieName = 'client_portal_refresh';

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  register(
    @Body()
    body: {
      email?: string;
      username?: string;
      password?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(
    @Body()
    body: {
      identifier?: string;
      password?: string;
    },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body);
    this.setRefreshCookie(response, request, result.refresh_token, result.refresh_expires_at);
    return {
      access_token: result.access_token,
      token_type: 'bearer',
    };
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.readRefreshCookie(request);
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, request, result.refresh_token, result.refresh_expires_at);
    return {
      access_token: result.access_token,
      token_type: 'bearer',
    };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(this.readRefreshCookie(request, false));
    this.clearRefreshCookie(response, request);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() currentUser: AuthUser) {
    return this.authService.getCurrentUser(currentUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('api/v1/profile')
  updateProfile(
    @CurrentUser() currentUser: AuthUser,
    @Body()
    body: {
      nickname?: string;
      username?: string;
      phone?: string;
      address?: string;
    },
  ) {
    return this.authService.updateProfile(currentUser.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/v1/profile/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  uploadAvatar(
    @CurrentUser() currentUser: AuthUser,
    @UploadedFile() file?: UploadedAvatarFile,
  ) {
    return this.authService.uploadProfileAvatar(currentUser.userId, file);
  }

  private readRefreshCookie(request: Request, required = true) {
    const cookies = this.parseCookieHeader(request.headers.cookie || '');
    const token = cookies[this.refreshCookieName] || '';

    if (!token && required) {
      throw new UnauthorizedException('Missing refresh cookie');
    }

    return token;
  }

  private parseCookieHeader(header: string) {
    return header.split(';').reduce<Record<string, string>>((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) {
        return cookies;
      }
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (key) {
        cookies[key] = decodeURIComponent(value);
      }
      return cookies;
    }, {});
  }

  private setRefreshCookie(
    response: Response,
    request: Request,
    refreshToken: string,
    expiresAt: Date,
  ) {
    response.cookie(this.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: this.shouldUseSecureCookie(request),
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(response: Response, request: Request) {
    response.clearCookie(this.refreshCookieName, {
      httpOnly: true,
      secure: this.shouldUseSecureCookie(request),
      sameSite: 'lax',
      path: '/',
    });
  }

  private shouldUseSecureCookie(request: Request) {
    const configured = this.configService.get<string>('REFRESH_COOKIE_SECURE');
    if (configured) {
      return configured.toLowerCase() === 'true';
    }

    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
    return forwardedProto === 'https' || request.secure || process.env.NODE_ENV === 'production';
  }
}
