/** /flow/steps 返回的单个选项（身份 / 设备胶囊等） */
export interface FlowStepOption {
  /** 展示文案，如「老板」「38台体验设备」 */
  label: string;
  /** 渲染类型：STATIC / PROJECT_COUNT / DEVICE_COUNT / DEVICE_TYPE 等 */
  bubbleType: string;
  /**
   * 命中值（接口字段名）：身份即角色码（OWNER / ADMIN / OPERATOR），
   * 作业指导里是机型（SCC4000A-8）或经验（EXPERIENCED）等。
   */
  hValue?: string | null;
  /** 命中值的兼容字段：早期接口/前端内部统一按这个名字取，读取时 hValue 优先 */
  hitValue?: string | null;
  /** 排序号，按升序展示 */
  sortNo: number;
}

/** 流程中的一个步骤 */
export interface FlowStep {
  /** 步骤码：IDENTITY / IDENTITY_DETAIL / HEY / INTRO / DEVICE / EXPERIENCE / MODEL_EXPERIENCE 等 */
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
  /** 业务模块：游客欢迎流程 ASK，作业指导 GUIDE */
  module: string;
  /** 角色码：身份选择页命中某个身份后，用它拉该身份的 IDENTITY_DETAIL 步骤 */
  roleCode?: string;
  /** 设备类型（带屏 / 不带屏），用于适配 SCC */
  deviceType?: string;
  /** 机型型号，用于机型相关的步骤标题 */
  deviceModel?: string;
  /** 语速倍率 */
  ttsSpeechRate?: number;
}
