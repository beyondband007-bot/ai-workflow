import { forwardRef, Module } from '@nestjs/common';
import { PointAccountsModule } from '../point-accounts/point-accounts.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { CallbackSignatureService } from './callback-signature.service';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowRunsService } from './workflow-runs.service';

@Module({
  imports: [forwardRef(() => WorkflowsModule), PointAccountsModule],
  controllers: [WorkflowRunsController],
  providers: [WorkflowRunsService, CallbackSignatureService],
  exports: [WorkflowRunsService],
})
export class WorkflowRunsModule {}
