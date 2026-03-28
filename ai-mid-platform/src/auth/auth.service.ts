import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { PointAccountsService } from '../point-accounts/point-accounts.service';
import { User } from '../users/user.entity';

type RegisterPayload = {
  email?: string;
  username?: string;
  password?: string;
};

type LoginPayload = {
  identifier?: string;
  password?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly pointAccountsService: PointAccountsService,
  ) {}

  async register(payload: RegisterPayload) {
    const email = payload.email?.trim().toLowerCase();
    const username = payload.username?.trim();
    const password = payload.password ?? '';

    if (!email) {
      throw new BadRequestException('email is required');
    }

    if (!username) {
      throw new BadRequestException('username is required');
    }

    if (password.length < 6) {
      throw new BadRequestException('password must be at least 6 characters');
    }

    const existingEmail = await this.usersRepository.findOneBy({ email });
    if (existingEmail) {
      throw new BadRequestException('邮箱已被注册');
    }

    const existingUsername = await this.usersRepository.findOneBy({ username });
    if (existingUsername) {
      throw new BadRequestException('用户名已被占用');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = this.usersRepository.create({
      email,
      username,
      passwordHash,
    });

    const savedUser = await this.usersRepository.save(user);
    await this.pointAccountsService.ensurePointAccount(savedUser.id);

    return this.serializeUser(savedUser);
  }

  async login(payload: LoginPayload) {
    const identifier = payload.identifier?.trim();
    const password = payload.password ?? '';

    if (!identifier) {
      throw new BadRequestException('identifier is required');
    }

    if (!password) {
      throw new BadRequestException('password is required');
    }

    const user = await this.usersRepository.findOne({
      where: [{ email: identifier.toLowerCase() }, { username: identifier }],
    });

    if (!user) {
      throw new UnauthorizedException('用户名/邮箱或密码错误');
    }

    const passwordMatched = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatched) {
      throw new UnauthorizedException('用户名/邮箱或密码错误');
    }

    if (!user.isActive) {
      throw new ForbiddenException('账号已被禁用');
    }

    user.lastLoginAt = new Date();
    await this.usersRepository.save(user);

    return {
      access_token: this.createAccessToken(user.id, user.email),
    };
  }

  async getCurrentUser(userId: number) {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.serializeUser(user);
  }

  private createAccessToken(userId: number, email: string) {
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');

    return sign(
      {
        sub: String(userId),
        email,
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '60m',
      },
    );
  }

  private serializeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      is_active: Boolean(user.isActive),
      created_at: user.createdAt,
      last_login_at: user.lastLoginAt,
    };
  }
}
