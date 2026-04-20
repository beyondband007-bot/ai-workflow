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
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
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

type UpdateProfilePayload = {
  nickname?: string;
  username?: string;
  phone?: string;
  address?: string;
};

type UploadedAvatarFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
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

    return this.serializeUser(
      user,
      await this.getWf003FeishuBinding(user.id),
    );
  }

  async updateProfile(userId: number, payload: UpdateProfilePayload) {
    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('user not found');
    }

    const nextUsername = payload.username?.trim().toLowerCase();
    const nextNickname = payload.nickname?.trim() || null;
    const nextPhone = payload.phone?.trim() || null;
    const nextAddress = payload.address?.trim() || null;

    if (!nextNickname) {
      throw new BadRequestException('nickname is required');
    }

    if (!nextUsername) {
      throw new BadRequestException('username is required');
    }

    if (!/^[a-z0-9_]{3,24}$/.test(nextUsername)) {
      throw new BadRequestException(
        'username must be 3-24 chars and only contain letters, numbers, and underscores',
      );
    }

    if (nextPhone && !/^[0-9+\-()\s]{6,20}$/.test(nextPhone)) {
      throw new BadRequestException('phone format is invalid');
    }

    if (nextAddress && nextAddress.length > 255) {
      throw new BadRequestException('address is too long');
    }

    if (user.username !== nextUsername) {
      const existingUsername = await this.usersRepository.findOneBy({
        username: nextUsername,
      });

      if (existingUsername && existingUsername.id !== user.id) {
        throw new BadRequestException('username already exists');
      }
    }

    user.username = nextUsername;
    user.nickname = nextNickname.slice(0, 100);
    user.phone = nextPhone?.slice(0, 32) ?? null;
    user.address = nextAddress?.slice(0, 255) ?? null;

    const savedUser = await this.usersRepository.save(user);

    return this.serializeUser(
      savedUser,
      await this.getWf003FeishuBinding(savedUser.id),
    );
  }

  async uploadProfileAvatar(userId: number, file?: UploadedAvatarFile) {
    if (!file) {
      throw new BadRequestException('avatar file is required');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('avatar must be an image');
    }

    const user = await this.usersRepository.findOneBy({ id: userId });

    if (!user) {
      throw new NotFoundException('user not found');
    }

    const avatarDir = await this.ensureAvatarDir();
    const extension = this.resolveAvatarExtension(file);
    const fileName = `${userId}-${Date.now()}-${randomUUID()}${extension}`;
    const filePath = resolve(avatarDir, fileName);

    await writeFile(filePath, file.buffer);
    await this.removePreviousAvatar(user.avatarImg, avatarDir);

    user.avatarImg = `/portal/avatar/${fileName}`;
    await this.usersRepository.save(user);

    return {
      avatar_img: user.avatarImg,
      avatar_url: user.avatarImg,
    };
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
        expiresIn: '1d',
      },
    );
  }

  private async getWf003FeishuBinding(userId: number) {
    const [binding] = await this.usersRepository.query(
      `
        SELECT feishu_app_id, feishu_id
        FROM wf_003_feishu
        WHERE user_id = ?
        LIMIT 1
      `,
      [userId],
    );

    return {
      feishu_app_id: binding?.feishu_app_id ?? null,
      feishu_id: binding?.feishu_id ?? null,
    };
  }

  private serializeUser(
    user: User,
    binding: { feishu_app_id: string | null; feishu_id: string | null } = {
      feishu_app_id: null,
      feishu_id: null,
    },
  ) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatar_img: user.avatarImg,
      phone: user.phone,
      address: user.address,
      feishu_app_id: binding.feishu_app_id,
      feishu_id: binding.feishu_id,
      is_active: Boolean(user.isActive),
      created_at: user.createdAt,
      last_login_at: user.lastLoginAt,
    };
  }

  private async ensureAvatarDir() {
    const configuredDir = this.configService.get<string>('CLIENT_PORTAL_AVATAR_DIR');
    const targetDir = configuredDir
      ? resolve(configuredDir)
      : resolve(process.cwd(), '..', 'client-portal', 'avatar');

    await mkdir(targetDir, { recursive: true });
    return targetDir;
  }

  private resolveAvatarExtension(file: UploadedAvatarFile) {
    const originalExt = extname(file.originalname || '').toLowerCase();
    if (originalExt && /^[.][a-z0-9]+$/.test(originalExt)) {
      return originalExt;
    }

    const mimeTypeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };

    return mimeTypeMap[file.mimetype] || '.png';
  }

  private async removePreviousAvatar(
    avatarImg: string | null,
    avatarDir: string,
  ) {
    if (!avatarImg || !avatarImg.startsWith('/portal/avatar/')) {
      return;
    }

    const previousPath = resolve(avatarDir, basename(avatarImg));

    try {
      await rm(previousPath, { force: true });
    } catch (error) {
      console.warn('failed to remove previous avatar', error);
    }
  }
}
