import { WorkflowDefinition } from './workflow-definition.interface';

export const WORKFLOW_CATALOG: WorkflowDefinition[] = [
  {
    workflow_code: 'WF-001',
    workflow_name: '性价比文生图',
    current_status: '已运行',
    metering_mode: '固定积分',
    base_points: 30,
    unit_points: null,
    description: '适合日常配图与营销素材创作，快速生成稳定可用的图片。',
    max_estimated_count: 1,
    max_frozen_points: 30,
  },
  {
    workflow_code: 'WF-002',
    workflow_name: '高质量文生图',
    current_status: '已运行',
    metering_mode: '固定积分',
    base_points: 50,
    unit_points: null,
    description: '适合高标准视觉创作，生成细节更丰富、质感更高的图片。',
    max_estimated_count: 1,
    max_frozen_points: 50,
  },
  {
    workflow_code: 'WF-003',
    workflow_name: '跨境电商图生图',
    current_status: '已运行',
    metering_mode: '按结果计量',
    base_points: null,
    unit_points: 30,
    description: '适合跨境商品视觉展示，生成更贴合海外市场的营销场景图。',
    max_estimated_count: 7,
    max_frozen_points: 210,
  },
];