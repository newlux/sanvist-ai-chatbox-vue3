import type { AiBlock } from "./chatStreamParser";

/**
 * 把回答正文里的 ECharts 代码块拆成独立的 chart 块。
 *
 * 后端大多数时候会单独推 chart 事件，但模型也会直接在正文里写
 * ```echarts / ```json 围栏（网关那侧同样有这条兜底解析）。
 * 端上不处理的话，用户看到的就是一坨 JSON 源码。
 *
 * 只拆「已经闭合」的围栏：流式输出到一半的代码块留在正文里，
 * 等它写完再变成图表，避免半截 JSON 反复解析失败。
 */

const FENCE_PATTERN = /```(echarts|json)[^\n]*\n([\s\S]*?)```/g;

/** 判断一段 JSON 是不是 ECharts option：认 series，或者常见的坐标轴组合 */
function isEchartsOption(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const option = value as Record<string, unknown>;
  if (Array.isArray(option.series) && option.series.length) return true;
  return Boolean(option.xAxis || option.yAxis || option.radar || option.polar);
}

function parseChartPayload(raw: string) {
  try {
    const parsed = JSON.parse(raw.trim());
    if (isEchartsOption(parsed)) return { option: parsed };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const payload = parsed as Record<string, unknown>;
    if (!isEchartsOption(payload.option)) return null;
    return {
      option: payload.option,
      layout: payload.layout && typeof payload.layout === "object" ? payload.layout : undefined,
    };
  } catch {
    return null;
  }
}

function answerBlock(id: string, content: string, complete: boolean): AiBlock {
  return { id, type: "answer", payload: { content }, complete };
}

/**
 * 展开单个 answer 块。没有可解析的图表时原样返回，避免制造无谓的新对象。
 */
function expandAnswerBlock(block: AiBlock): AiBlock[] {
  const content = String(block?.payload?.content || "");
  if (!content.includes("```")) return [block];

  const pieces: AiBlock[] = [];
  let lastIndex = 0;
  let chartIndex = 0;
  FENCE_PATTERN.lastIndex = 0;

  for (let matched = FENCE_PATTERN.exec(content); matched; matched = FENCE_PATTERN.exec(content)) {
    const chartPayload = parseChartPayload(matched[2]);
    // ```json 里也可能是普通 JSON，认不出 option 就留在正文里当代码块
    if (!chartPayload) continue;

    const before = content.slice(lastIndex, matched.index).trim();
    if (before) pieces.push(answerBlock(`${block.id}-text-${pieces.length}`, before, true));
    pieces.push({
      id: `${block.id}-chart-${chartIndex += 1}`,
      type: "chart",
      payload: chartPayload,
      complete: true,
    });
    lastIndex = matched.index + matched[0].length;
  }

  if (!pieces.length) return [block];

  const rest = content.slice(lastIndex).trim();
  if (rest) pieces.push(answerBlock(`${block.id}-text-${pieces.length}`, rest, block.complete));
  return pieces;
}

/** 批量展开：非 answer 块原样透传 */
export function expandChartFences(blocks: AiBlock[]): AiBlock[] {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.some(block => block?.type === "answer")) return list;

  const expanded: AiBlock[] = [];
  let changed = false;
  list.forEach((block) => {
    if (block?.type !== "answer") {
      expanded.push(block);
      return;
    }
    const parts = expandAnswerBlock(block);
    if (parts.length !== 1 || parts[0] !== block) changed = true;
    expanded.push(...parts);
  });
  return changed ? expanded : list;
}
