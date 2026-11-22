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

/**
 * 展开单个 answer 块。没有可解析的图表时原样返回，避免制造无谓的新对象。
 */
function expandAnswerBlock(block: AiBlock): AiBlock[] {
  const content = String(block?.payload?.content || "");
  if (!content.includes("```")) return [block];

  const pieces: AiBlock[] = [];
  let lastIndex = 0;
  /** 正文片 / 图表片各自计数，规则与 tableFence 保持一致 */
  let textCount = 0;
  let chartCount = 0;
  FENCE_PATTERN.lastIndex = 0;

  /**
   * 追加一段正文片。
   *
   * 第一段沿用原块 id：图表围栏闭合、块被拆开的瞬间，Vue 才会复用同一个 AnswerBlock，
   * 打字机进度不会归零重打（与 tableFence 的约定一致）。
   * 后缀用 `-chart-text-` 而不是 `-text-`：两个展开器串行跑（先表格后图表），
   * 图表拆分拿到的正是表格拆分保留下来的原 id，同款后缀会撞出重复 key。
   *
   * payload 整份带上：replayed / speechText 等标记不能在这里丢掉，
   * 否则重放块会退回逐字重打、播报稿也会缺一段（与 tableFence 一致）。
   */
  function appendText(raw: string, complete: boolean) {
    const text = raw.trim();
    if (!text) return;
    pieces.push({
      ...block,
      id: textCount === 0 ? block.id : `${block.id}-chart-text-${textCount}`,
      payload: { ...block.payload, content: text },
      complete,
    });
    textCount += 1;
  }

  for (let matched = FENCE_PATTERN.exec(content); matched; matched = FENCE_PATTERN.exec(content)) {
    const chartPayload = parseChartPayload(matched[2]);
    // ```json 里也可能是普通 JSON，认不出 option 就留在正文里当代码块
    if (!chartPayload) continue;

    appendText(content.slice(lastIndex, matched.index), true);
    pieces.push({
      id: `${block.id}-chart-${chartCount}`,
      type: "chart",
      payload: chartPayload,
      complete: true,
    });
    chartCount += 1;
    lastIndex = matched.index + matched[0].length;
  }

  if (!pieces.length) return [block];

  appendText(content.slice(lastIndex), block.complete);
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
