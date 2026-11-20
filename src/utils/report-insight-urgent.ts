import type { ReportInsightEvent } from "@/api/report-insight";
import { getReportInsightEvents, toggleReportInsightUrgent } from "@/api/report-insight";
import { createLogger } from "@/utils/logger";

/**
 * 「异常全部加急」的接口编排：
 * 先分页拉全量异常列表，再拿返回里 items 的 eventId 逐个调加急接口（传参只有 eventId）。
 *
 * 触发链路前面的部分保持不变（EMERGENCY 标签命中 → 拉一遍列表 → 逐条加急）；
 * 这里不再按 urgent 状态筛条目：接口返回的每个 eventId 都会被循环调用一次。
 */

const logger = createLogger("report-insight-urgent");

/** 取数用的每页条数（只影响这次全量拉取，不改列表页的分页大小） */
const FETCH_PAGE_SIZE = 100;
/** 服务端 hasMore 恒真时的保护，避免死循环 */
const MAX_PAGES = 50;
/** 加急请求的并发上限，逐批发送，避免一次打出几十个请求 */
const URGENT_CONCURRENCY = 5;

export interface UrgentAllReportInsightResult {
  /** 异常列表条目总数 */
  total: number;
  /** 本次循环调用的条目数（items 全量，不按 urgent 过滤） */
  pending: number;
  /** 加急接口回包里 urgent 为 true 的条目数 */
  urgent: number;
}

/** 分页拉全量：列表接口按 page / pageSize 返回，靠 hasMore 收尾 */
async function fetchAllReportInsightEvents(): Promise<ReportInsightEvent[]> {
  const events: ReportInsightEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await getReportInsightEvents({ page, pageSize: FETCH_PAGE_SIZE });
    // request 已剥掉外层 { code, message, data }，这里拿到的就是 data 本身
    const items = Array.isArray(result?.items) ? result.items : [];
    events.push(...items);
    if (!result?.hasMore || !items.length) break;
  }
  return events;
}

export async function urgentAllReportInsightEvents(): Promise<UrgentAllReportInsightResult> {
  let events: ReportInsightEvent[] = [];
  try {
    events = await fetchAllReportInsightEvents();
  }
  catch (error) {
    logger.error("[urgent-all] 拉取异常列表失败", error);
    return { total: 0, pending: 0, urgent: 0 };
  }

  logger.info("[urgent-all] 异常列表拉取完成", { total: events.length });
  if (!events.length) return { total: 0, pending: 0, urgent: 0 };

  // 循环 items 里的每一个 eventId 调一次加急接口，已加急的条目同样要调
  let urgent = 0;
  for (let index = 0; index < events.length; index += URGENT_CONCURRENCY) {
    const batch = events.slice(index, index + URGENT_CONCURRENCY);
    const results = await Promise.all(batch.map(async (event) => {
      try {
        const result = await toggleReportInsightUrgent({ eventId: event.eventId });
        return Boolean(result?.urgent);
      }
      catch (error) {
        logger.error("[urgent-all] 加急失败", { eventId: event.eventId, error });
        return false;
      }
    }));
    urgent += results.filter(Boolean).length;
  }

  logger.info("[urgent-all] 全部加急完成", { total: events.length, pending: events.length, urgent });
  return { total: events.length, pending: events.length, urgent };
}
