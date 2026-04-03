import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';

@Injectable()
export class PointAccountsService {
  constructor(private readonly dataSource: DataSource) {}

  async getMyPointAccount(currentUser: AuthUser) {
    const [user] = await this.dataSource.query(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.is_active,
          f.feishu_app_id,
          f.feishu_id
        FROM users u
        LEFT JOIN wf_003_feishu f ON f.user_id = u.id
        WHERE u.id = ?
        LIMIT 1
      `,
      [currentUser.userId],
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const pointAccount = await this.ensurePointAccount(currentUser.userId);

    const [todayUsage] = await this.dataSource.query(
      `
        SELECT
          COUNT(*) AS today_runs,
          COALESCE(SUM(points_cost), 0) AS today_spent_points
        FROM api_call_logs
        WHERE user_id = ?
          AND DATE(created_at) = CURDATE()
      `,
      [currentUser.userId],
    );

    return {
      user_id: String(user.id),
      email: user.email,
      username: user.username,
      feishu_app_id: user.feishu_app_id ?? null,
      feishu_id: user.feishu_id ?? null,
      is_active: Boolean(user.is_active),
      available_points: Number(pointAccount.available_points ?? 0),
      frozen_points: Number(pointAccount.frozen_points ?? 0),
      total_recharged_points: Number(pointAccount.total_recharged_points ?? 0),
      total_consumed_points: Number(pointAccount.total_consumed_points ?? 0),
      today_runs: Number(todayUsage?.today_runs ?? 0),
      today_spent_points: Number(todayUsage?.today_spent_points ?? 0),
    };
  }

  async ensurePointAccount(userId: number, queryRunner?: QueryRunner) {
    const executor = queryRunner?.manager ?? this.dataSource;

    const [existingAccount] = await executor.query(
      `
        SELECT
          user_id,
          available_points,
          frozen_points,
          total_recharged_points,
          total_consumed_points
        FROM point_accounts
        WHERE user_id = ?
        LIMIT 1
      `,
      [userId],
    );

    if (existingAccount) {
      return this.normalizeAccount(existingAccount);
    }

    const insertResult = await executor.query(
      `
        INSERT IGNORE INTO point_accounts (
          user_id,
          available_points,
          frozen_points,
          total_recharged_points,
          total_consumed_points
        ) VALUES (?, 100, 0, 100, 0)
      `,
      [userId],
    );

    if (insertResult?.affectedRows === 1) {
      await executor.query(
        `
          INSERT INTO points_transactions (
            user_id,
            type,
            points,
            balance_after,
            remark
          ) VALUES (?, 'manual_adjust', 100, 100, 'Initial default points for new account')
        `,
        [userId],
      );
    }

    const [createdAccount] = await executor.query(
      `
        SELECT
          user_id,
          available_points,
          frozen_points,
          total_recharged_points,
          total_consumed_points
        FROM point_accounts
        WHERE user_id = ?
        LIMIT 1
      `,
      [userId],
    );

    return this.normalizeAccount(createdAccount);
  }

  private normalizeAccount(account: Record<string, unknown>) {
    return {
      user_id: Number(account.user_id ?? 0),
      available_points: Number(account.available_points ?? 0),
      frozen_points: Number(account.frozen_points ?? 0),
      total_recharged_points: Number(account.total_recharged_points ?? 0),
      total_consumed_points: Number(account.total_consumed_points ?? 0),
    };
  }
}
