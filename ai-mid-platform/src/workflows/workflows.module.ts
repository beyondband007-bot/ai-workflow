import { forwardRef, Module } from '@nestjs/common';
import { WorkflowRunsModule } from '../workflow-runs/workflow-runs.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [forwardRef(() => WorkflowRunsModule)],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowExecutionService],
  exports: [WorkflowsService, WorkflowExecutionService],
})
export class WorkflowsModule {}
