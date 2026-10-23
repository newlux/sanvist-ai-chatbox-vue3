/** /flow/steps 返回的单个选项（身份 / 设备胶囊等） */
export interface FlowStepOption {
  /** 展示文案，如「老板」「38台体验设备」 */
  label: string;
  /** 渲染类型：STATIC / PROJECT_COUNT / DEVICE_COUNT / DEVICE_TYPE 等 */
  bubbleType: string;
  /** 命中值：身份即角色码（OWNER / ADMIN / OPERATOR），计数类为 null */
  hitValue: string | null;
  /** 排序号，按升序展示 */
  sortNo: number;
}

/** 流程中的一个步骤 */
export interface FlowStep {
  /** 步骤码：IDENTITY / IDENTITY_DETAIL 等 */
  stepCode: string;
  /** 页面标题（身份选择页就是那句「100号游客，请选择你的身份吧」） */
  title: string;
  /** 副标题 / 提示，可能为 null */
  hint: string | null;
  /** 该步骤下的选项，可能为空数组 */
  options: FlowStepOption[];
}

export interface FlowStepsData {
  steps: FlowStep[];
}

export interface FlowStepsParams {
  /** 业务模块，游客欢迎流程固定 ASK */
  module: string;
  /** 角色码：身份选择页命中某个身份后，用它拉该身份的 IDENTITY_DETAIL 步骤 */
  roleCode?: string;
}
