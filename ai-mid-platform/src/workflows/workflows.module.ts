import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowRunsModule } from '../workflow-runs/workflow-runs.module';
import { Wf003ManufacturerLogo } from './wf003-manufacturer-logo.entity';
import { Wf003ManufacturerLogosController } from './wf003-manufacturer-logos.controller';
import { Wf003ManufacturerLogosService } from './wf003-manufacturer-logos.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wf003ManufacturerLogo]),
    forwardRef(() => WorkflowRunsModule),
  ],
  controllers: [WorkflowsController, Wf003ManufacturerLogosController],
  providers: [
    WorkflowsService,
    WorkflowExecutionService,
    Wf003ManufacturerLogosService,
  ],
  exports: [
    WorkflowsService,
    WorkflowExecutionService,
    Wf003ManufacturerLogosService,
  ],
})
export class WorkflowsModule {}
