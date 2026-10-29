/**
 * 任务协同「异常情况摘要」卡片的数据口径（Ardot 350:2151 / 节点 350:2199 Group 24）。
 *
 * 数据来源：POST /proxy/v1/workflows/run（inputs.query_type=查异常）的 `data.outputs`。
 *
 * 实际回包长这样（业务包被塞进一个 mPaaS 组件文本里）：
 * ```json
 * {
 *   "component": "<COMPONENT>\n{\"scene\":\"task\",\"type\":\"exception\",\"data\":{...}}\n</COMPONENT>"
 * }
 * ```
 * 里面 `data` 才是卡片内容（title / exceptionObject / description / suggestions）。
 * 字段名做过几轮调整，所以这里仍是宽松解析：能认出几条就渲染几条；
 * 一条都认不出（或接口报错）时返回 null —— 页面只在 run 接口真的给出数据后才铺卡，
 * 请求中 / 失败时待机区不放任何卡片（不再用设计稿样张顶替）。
 *
 * 卡片只有两块：标题 + 「标签 / 值」两列行（设计稿：异常对象 / 异常情况）；
 * 建议问题随卡片一起下发，页面拿去铺「你还可以这么问」，取不到时回落到本地兜底文案。
 */
export interface TaskExceptionRow {
  /** 左侧标签，自带冒号（设计稿「异常对象：」） */
  label: string;
  /** 右侧内容，可多行 */
  value: string;
}

export interface TaskExceptionCard {
  title: string;
  rows: TaskExceptionRow[];
}

/**
 * 解析结果：
 * - `card`：接口真给了可展示内容才有值，认不出时为 null（页面据此决定这张卡渲不渲染）；
 * - `suggestions`：随卡片下发的建议问题，没有就是空数组。
 */
export interface TaskExceptionSummary {
  card: TaskExceptionCard | null;
  suggestions: string[];
}

/**
 * 设计稿 350:2199 的文案口径（「异常情况摘要」+ 行标签）。
 * 只作为标题缺省值与行标签来源，不再整卡兜底 —— 没有接口数据就不铺卡。
 */
export const TASK_EXCEPTION_MOCK: TaskExceptionCard = {
  title: "异常情况摘要",
  rows: [
    { label: "异常对象：", value: "混凝土搅拌车--粤A8766H" },
    { label: "异常情况：", value: "搅拌车堵车，预计晚到 50 分钟，可能影响现场浇筑作业" },
  ],
};

/** 标题 / 对象 / 描述的可选字段名（后端换写法时不用改组件） */
const TITLE_KEYS = ["title", "card_title", "cardTitle", "summary_title", "summaryTitle"];
const OBJECT_KEYS = ["exception_object", "exceptionObject", "object", "target", "device", "device_name", "deviceName", "vehicle"];
const DESC_KEYS = ["exception_desc", "exceptionDesc", "description", "desc", "detail", "content", "message", "exception"];
/** 建议问题的可选字段名 */
const SUGGESTION_KEYS = ["suggestions", "suggestion", "follow_ups", "followUps", "recommend_questions", "recommendQuestions", "questions"];
/** 业务数据可能被再包一层（component 是 mPaaS 组件文本的常见外包字段） */
const NESTED_KEYS = ["data", "result", "output", "outputs", "component"];
/** 最多往下钻几层，防止异常结构里的循环引用把解析卡死 */
const MAX_DEPTH = 4;

/** `<COMPONENT>...</COMPONENT>` 组件文本：标签大小写不固定，只认第一段 */
const COMPONENT_WRAPPER_RE = /<component>([\s\S]*?)<\/component>/i;

/** 去掉组件文本外壳，取出里面那段 JSON 文本；没有外壳时原样返回 */
function unwrapComponentText(text: string) {
  const match = text.match(COMPONENT_WRAPPER_RE);
  return (match?.[1] ?? text).trim();
}

function toRecord(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (raw == null || depth > MAX_DEPTH) return null;
  // 后端有时把整包当 JSON 字符串回传，也可能整段塞在 <COMPONENT> 里
  if (typeof raw === "string") {
    const text = unwrapComponentText(raw.trim());
    if (!text.startsWith("{")) return null;
    try {
      return toRecord(JSON.parse(text), depth + 1);
    }
    catch {
      return null;
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * 把这棵对象按「外层 → 命中的嵌套层」摊平，后面逐层找卡片 / 建议问题。
 * outputs 这种 `{ component: '<COMPONENT>{"data":{...}}</COMPONENT>' }` 的结构要走两层才能摸到业务字段。
 */
function collectLayers(raw: unknown, depth = 0, layers: Array<Record<string, unknown> | null> = []) {
  if (depth > MAX_DEPTH) return layers;
  const record = toRecord(raw);
  if (!record) return layers;
  layers.push(record);
  for (const key of NESTED_KEYS) {
    const value = record[key];
    if (value != null) collectLayers(value, depth + 1, layers);
  }
  return layers;
}

function pickText(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/** 接口直接给 rows / items 数组时按它渲染；标签统一补上设计稿的冒号 */
function pickRows(source: Record<string, unknown> | null): TaskExceptionRow[] {
  if (!source) return [];
  const list = source.rows ?? source.items ?? source.exceptions;
  if (!Array.isArray(list)) return [];
  return list.reduce<TaskExceptionRow[]>((rows, item) => {
    const record = toRecord(item);
    const label = pickText(record, ["label", "name", "key", "title"]);
    const value = pickText(record, ["value", "content", "text", "desc", "description"]);
    if (label && value) rows.push({ label: label.endsWith("：") ? label : `${label}：`, value });
    return rows;
  }, []);
}

/** 建议问题：数组里只留非空字符串，去重后返回 */
function pickSuggestions(source: Record<string, unknown> | null): string[] {
  if (!source) return [];
  for (const key of SUGGESTION_KEYS) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    const list = value.reduce<string[]>((out, item) => {
      const text = typeof item === "string" ? item.trim() : pickText(toRecord(item), ["text", "content", "question", "title", "value"]);
      if (text && !out.includes(text)) out.push(text);
      return out;
    }, []);
    if (list.length) return list;
  }
  return [];
}

/** 从一层对象里读卡片；一条有效行都没有时返回 null（交给下一层继续找） */
function readCard(raw: unknown): TaskExceptionCard | null {
  const source = toRecord(raw);
  if (!source) return null;

  const rows = pickRows(source);
  if (rows.length) return { title: pickText(source, TITLE_KEYS) || TASK_EXCEPTION_MOCK.title, rows };

  const object = pickText(source, OBJECT_KEYS);
  const desc = pickText(source, DESC_KEYS);
  if (!object && !desc) return null;

  // 只给了一侧也只渲染那一侧：缺的那行整行不出现，不编造内容
  const fallback: TaskExceptionRow[] = [];
  if (object) fallback.push({ label: TASK_EXCEPTION_MOCK.rows[0].label, value: object });
  if (desc) fallback.push({ label: TASK_EXCEPTION_MOCK.rows[1].label, value: desc });
  return { title: pickText(source, TITLE_KEYS) || TASK_EXCEPTION_MOCK.title, rows: fallback };
}

/**
 * 把工作流返回（data.outputs 或整包）解析成「卡片 + 建议问题」。
 * 逐层往下找：卡片一条都认不出时 `card` 为 null（页面不铺这张卡），
 * 建议问题没下发时返回空数组（页面据此回落到本地兜底文案）。
 */
export function resolveExceptionSummary(raw: unknown): TaskExceptionSummary {
  const layers = collectLayers(raw);
  const card = layers.map(readCard).find((item): item is TaskExceptionCard => Boolean(item)) ?? null;
  const suggestions = layers.map(pickSuggestions).find(item => item.length > 0) ?? [];
  return { card, suggestions };
}
