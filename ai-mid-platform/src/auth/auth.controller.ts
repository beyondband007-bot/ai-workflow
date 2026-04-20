import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  constructor(private readonly authService: AuthService) {}

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
  login(
    @Body()
    body: {
      identifier?: string;
      password?: string;
    },
  ) {
    return this.authService.login(body);
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
}
