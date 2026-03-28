import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PointAccountsService } from './point-accounts.service';
import type { AuthUser } from '../auth/auth-user.interface';

@Controller('api/v1/point-accounts')
export class PointAccountsController {
  constructor(private readonly pointAccountsService: PointAccountsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyPointAccount(@CurrentUser() currentUser: AuthUser) {
    return this.pointAccountsService.getMyPointAccount(currentUser);
  }
}
