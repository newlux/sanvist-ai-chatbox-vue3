import type { GanttViewPayload } from "@/api/chat/types";
import { extractDifyHistoryBlocks } from "@/utils/ai-stream/dify";
import { hasGanttCard } from "@/utils/gantt-card";

/**
 * 任务协同「查今日进展」（POST /proxy/v1/workflows/run，inputs.query_type=查今日进展）的卡片解析。
 *
 * 回包与「查异常」同一套：业务包被塞进一个 mPaaS 组件文本里。
 * ```json
 * { "component": "<COMPONENT>\n{\"scene\":\"task\",\"type\":\"gantt\",\"data\":{...}}\n</COMPONENT>" }
 * ```
 * 里面 `data` 就是气泡里那张个人任务甘特图入口卡要的整包（viewType / card / rows），
 * 与对话接口下发的 gantt 积木结构一致，所以直接交给 GanttBlock 渲染即可。
 *
 * 解析不出（接口报错 / 老结构 / 没有卡片字段）时返回 null —— 页面就不铺这张卡，
 * 不再回落到对话接口，也不再拿样张顶替。
 */

/** 业务数据可能被再包一层（component 是 mPaaS 组件文本的常见外包字段） */
const NESTED_KEYS = ["component", "data", "result", "output", "outputs", "answer", "content", "text"];
/** 最多往下钻几层，防止异常结构里的循环引用把解析卡死 */
const MAX_DEPTH = 4;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * 把 outputs 摊成「组件文本 / 正文」字符串列表。
 * 交给协议解析器还原 blocks —— 这样 COMPONENT 外壳、scene/type 路由、
 * gantt data 的取法都与对话链路共用同一份实现，不在这里再写一套。
 */
function collectTexts(raw: unknown, depth = 0, out: string[] = []) {
  if (depth > MAX_DEPTH) return out;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text) out.push(text);
    return out;
  }
  const record = asRecord(raw);
  if (!record) return out;
  for (const key of NESTED_KEYS) {
    const value = record[key];
    if (value != null) collectTexts(value, depth + 1, out);
  }
  return out;
}

/** 兜底路径：outputs 本身（或再包几层后）已经是 `{ type: "gantt", data: {...} }` */
function findGanttData(raw: unknown, depth = 0): GanttViewPayload | null {
  if (depth > MAX_DEPTH) return null;
  const record = asRecord(raw);
  if (!record) return null;
  if (String(record.type || "").toLowerCase() === "gantt") {
    const data = asRecord(record.data);
    if (data) return data as GanttViewPayload;
  }
  for (const key of NESTED_KEYS) {
    const value = record[key];
    if (value == null) continue;
    const found = findGanttData(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 从 run 接口的 outputs 里取个人任务甘特图入口卡。
 * 先按协议文本解析（COMPONENT 外壳，取最后一个 gantt 块，越靠后越完整）；
 * 没有外壳时再按对象结构兜底找 type=gantt 的 data。
 * 没有卡片字段（card.visible === false 或整卡为空）时返回 null。
 */
export function resolveTaskGanttPayload(outputs: unknown): GanttViewPayload | null {
  for (const text of collectTexts(outputs)) {
    const ganttBlocks = extractDifyHistoryBlocks(text).filter(block => block.type === "gantt");
    const payload = ganttBlocks[ganttBlocks.length - 1]?.payload as GanttViewPayload | undefined;
    if (payload && hasGanttCard(payload)) return payload;
  }

  const direct = findGanttData(outputs);
  return direct && hasGanttCard(direct) ? direct : null;
}
