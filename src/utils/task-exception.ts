/**
 * 任务协同「异常情况摘要」卡片的数据口径（Ardot 350:2151 / 节点 350:2199 Group 24）。
 *
 * 数据来源：POST /proxy/v1/workflows/run（inputs.query_type=查异常）的 `data.outputs`。
 * 现在后端这条工作流的返回结构还在变（字段名 / 是否套 JSON 字符串都不固定），
 * 所以这里做「宽松解析 + mock 兜底」：能认出几条就渲染几条，一条都认不出（或接口报错）
 * 就用 MOCK 顶上，保证页面永远有内容、不出现空卡片。
 *
 * 卡片只有两块：标题 + 「标签 / 值」两列行（设计稿：异常对象 / 异常情况）。
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

/** 设计稿 350:2199 的原文：接口没数据时直接用它，保证版式与稿子一致 */
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
/** 业务数据可能被再包一层 */
const NESTED_KEYS = ["data", "result", "output", "outputs"];

function toRecord(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (raw == null || depth > 3) return null;
  // 后端有时把整包当 JSON 字符串回传
  if (typeof raw === "string") {
    const text = raw.trim();
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

/** 从一层对象里读卡片；一条有效行都没有时返回 null（交给下一层 / mock） */
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
 * 把工作流返回（data.outputs 或整包）解析成卡片数据；完全认不出时用 MOCK 兜底。
 * 依次尝试：外层对象 → 外层里再套的 data / result / output。
 */
export function resolveExceptionCard(raw: unknown): TaskExceptionCard {
  const outer = toRecord(raw);
  const direct = readCard(outer);
  if (direct) return direct;

  if (outer) {
    for (const key of NESTED_KEYS) {
      const nested = readCard(outer[key]);
      if (nested) return nested;
    }
  }
  return TASK_EXCEPTION_MOCK;
}
