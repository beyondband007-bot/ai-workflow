import { WorkflowDefinition } from './workflow-definition.interface';

export const WORKFLOW_CATALOG: WorkflowDefinition[] = [
  {
    workflow_code: 'WF-001',
    workflow_name: '性价比文生图',
    current_status: '测试',
    metering_mode: '固定积分',
    base_points: 10,
    unit_points: null,
    description: '用于基础链路验证和能力展示，适合作为轻量入口或内部测试流。',
    max_estimated_count: 1,
    max_frozen_points: 10,
  },
  {
    workflow_code: 'WF-002',
    workflow_name: '高质量文生图',
    current_status: '已运行',
    metering_mode: '固定积分',
    base_points: 30,
    unit_points: null,
    description: '面向纯 Webhook 触发链路，强调中台登记、执行回写和结果沉淀。',
    max_estimated_count: 1,
    max_frozen_points: 30,
  },
  {
    workflow_code: 'WF-003',
    workflow_name: '二手车出海图生图',
    current_status: '已运行',
    metering_mode: '按结果计量',
    base_points: null,
    unit_points: 30,
    description: '根据预估张数冻结积分，任务结束后按实际生成张数重新结算。',
    max_estimated_count: 7,
    max_frozen_points: 210,
  },
];
