import { Injectable, NotFoundException } from '@nestjs/common';
import { WORKFLOW_CATALOG } from './workflow-catalog';

@Injectable()
export class WorkflowsService {
  getAll() {
    return WORKFLOW_CATALOG;
  }

  getByCode(workflowCode: string) {
    return WORKFLOW_CATALOG.find((item) => item.workflow_code === workflowCode);
  }

  getByCodeOrThrow(workflowCode: string) {
    const workflow = this.getByCode(workflowCode);

    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowCode} not found`);
    }

    return workflow;
  }
}
