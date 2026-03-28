import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PointAccountsModule } from './point-accounts/point-accounts.module';
import { WorkflowRunsModule } from './workflow-runs/workflow-runs.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { User } from './users/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.getOrThrow<string>('DATABASE_HOST'),
        port: Number(configService.get<number>('DATABASE_PORT', 3306)),
        username: configService.getOrThrow<string>('DATABASE_USERNAME'),
        password: configService.getOrThrow<string>('DATABASE_PASSWORD'),
        database: configService.getOrThrow<string>('DATABASE_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        entities: [User],
      }),
    }),
    AuthModule,
    PointAccountsModule,
    WorkflowsModule,
    WorkflowRunsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
