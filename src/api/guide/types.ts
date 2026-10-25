/** GET /guide/profile：按机型 + 两轮经验算出受众（新老师傅）与讲解模式 */
export interface GuideProfileParams {
  /** 选中的机型代号，如 SCC4000A-8 */
  deviceModel: string;
  /** 第一轮命中值：EXPERIENCED / FAMILIARIZING / NOT_EXPERIENCED */
  experience: string;
  /** 第二轮命中值：MODEL_EXPERIENCED / MODEL_FAMILIAR / MODEL_NEW；不传按第一轮兜底 */
  modelExperience?: string;
}

export interface GuideProfileData {
  /** 选中的机型 */
  deviceModel: string;
  /** VETERAN 老师傅 / NEW 新师傅 */
  audience: string;
  /** 展示名（中英文按语言切换） */
  audienceName: string;
  /** skilled_operator / novice_operator，回传给 chat 接口 */
  operatorRole: string;
}

/** GET /recommended-questions/guide：推荐页的播报文案 + 推荐问题（按 sortNo 分页） */
export interface RecommendedQuestionsParams {
  deviceModel: string;
  experience: string;
  modelExperience?: string;
  /** 取几条，默认 3 */
  count?: number;
  /** 换一批偏移，默认 0；展示完返回空数组 */
  offset?: number;
}

export interface RecommendedQuestionsData {
  /** 推荐页顶部播报文案（按组合精确匹配，{roleName} 已填） */
  greeting: string;
  /** 推荐问题列表 */
  questions: string[];
}
