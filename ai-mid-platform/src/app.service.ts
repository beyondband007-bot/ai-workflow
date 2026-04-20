import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureUsersSchemaColumns();
    await this.ensurePortalAvatarDir();
  }

  getHello(): string {
    return 'AI Mid Platform is running.';
  }

  async getDatabaseHealth() {
    const result = await this.dataSource.query('SELECT 1 AS ok');
    const pingValue = Number(result[0]?.ok);

    return {
      status: 'ok',
      database: this.dataSource.options.database,
      ping: pingValue === 1,
    };
  }

  private async ensureUsersSchemaColumns() {
    const rows = await this.dataSource.query(
      `
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
      `,
    );

    const existingColumns = new Set(
      rows.map((row: { COLUMN_NAME?: string }) => String(row.COLUMN_NAME || '')),
    );
    const alterStatements: string[] = [];

    if (!existingColumns.has('nickname')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN nickname VARCHAR(100) NULL AFTER username',
      );
    }

    if (!existingColumns.has('avatar_img')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN avatar_img VARCHAR(500) NULL AFTER nickname',
      );
    }

    if (!existingColumns.has('phone')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL AFTER avatar_img',
      );
    }

    if (!existingColumns.has('address')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone',
      );
    }

    for (const statement of alterStatements) {
      await this.dataSource.query(statement);
      this.logger.log(`Applied schema update: ${statement}`);
    }
  }

  private async ensurePortalAvatarDir() {
    const configuredDir = this.configService.get<string>('CLIENT_PORTAL_AVATAR_DIR');
    const targetDir = configuredDir
      ? resolve(configuredDir)
      : resolve(process.cwd(), '..', 'client-portal', 'avatar');

    await mkdir(targetDir, { recursive: true });
  }
}
