import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(private readonly dataSource: DataSource) {}

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
}
