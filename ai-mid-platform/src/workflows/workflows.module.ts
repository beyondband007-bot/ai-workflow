import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowsService } from './workflows.service';

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowExecutionService],
  exports: [WorkflowsService, WorkflowExecutionService],
})
export class WorkflowsModule {}
