export interface WorkflowDefinition {
  workflow_code: string;
  workflow_name: string;
  current_status: '测试中' | '测试' | '运行中' | '已运行' | '在线' | '已暂停';
  metering_mode: '固定积分' | '按结果计量';
  base_points: number | null;
  unit_points: number | null;
  description: string;
  max_estimated_count: number;
  max_frozen_points: number;
}
