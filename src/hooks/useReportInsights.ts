import type { ReportInsightEvent, ToggleReportInsightUrgentResult } from "@/api/report-insight";
import type { ReportEventTypeCode } from "@/config/report-event-types";
import type { ReportListFilter, ReportUrgentTarget, ReportWorkflowAction } from "@/utils/ai-stream";
import { computed, ref } from "vue";
import { getReportInsightEvents, toggleReportInsightUrgent } from "@/api/report-insight";
import { normalizeEventTypeCode } from "@/config/report-event-types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-insights");

/** 加急相关动作的载荷：精确目标字段 / 目标对象 / 索引数组。 */
type UrgentAction =
  | Extract<ReportWorkflowAction, { type: "execute_urgent" }>
  | Extract<ReportWorkflowAction, { type: "cancel_execute" }>
  | ReportUrgentTarget;

const DEFAULT_PAGE_SIZE = 10;

export interface ReportInsightItem {
  id: string;
  deviceId: string;
  title: string;
  description: string;
  ownerTag: string;
  status: string;
  eventTypeCode: string;
  urgentText?: string;
  isUrgent: boolean;
  urgentLoading: boolean;
}

/** 事件类型码比对：服务端已过滤时不额外拦截，客户端仅做归一化后的兜底。 */
function matchesEventType(expected: ReportEventTypeCode[] | undefined, actual: string) {
  if (!expected?.length) return true;
  const target = normalizeEventTypeCode(actual);
  return expected.some(code => code === target);
}

function formatUrgentText(urgent: boolean, ownerTag: string) {
  if (!urgent) return undefined;
  return ownerTag || "已加急";
}

function toInsightItem(event: ReportInsightEvent): ReportInsightItem {
  return {
    id: event.eventId,
    deviceId: event.deviceNo,
    title: `${event.eventCategory}-${event.eventType}`,
    description: event.description,
    ownerTag: event.ownerTag,
    status: event.processStatus,
    eventTypeCode: event.eventTypeCode,
    urgentText: formatUrgentText(event.urgent, event.ownerTag),
    isUrgent: event.urgent,
    urgentLoading: false,
  };
}

export function useReportInsights(pageSize = DEFAULT_PAGE_SIZE) {
  const items = ref<ReportInsightItem[]>([]);
  const rawItems = ref<ReportInsightEvent[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loadError = ref(false);
  const currentPage = ref(0);
  const hasMore = ref(true);
  const currentFilter = ref<ReportListFilter | null>(null);
  const pendingUrgentTarget = ref<ReportUrgentTarget | null>(null);
  const urgentToastVisible = ref(false);
  const urgentToastMessage = ref("已加急");
  let urgentToastTimer: ReturnType<typeof setTimeout> | undefined;

  const isLoading = computed(() => loading.value || loadingMore.value);

  function showUrgentToast(message: "已加急" | "已取消加急" | "已处理") {
    urgentToastMessage.value = message;
    urgentToastVisible.value = true;
    if (urgentToastTimer) clearTimeout(urgentToastTimer);
    urgentToastTimer = setTimeout(() => {
      urgentToastVisible.value = false;
      urgentToastTimer = undefined;
    }, 2000);
  }

  async function fetchPage(page: number, append: boolean) {
    if (isLoading.value) {
      logger.warn("[filter_list] fetchPage 跳过：已有请求进行中", { page, append });
      return;
    }
    const eventType = currentFilter.value?.eventType;
    if (append) loadingMore.value = true;
    else loading.value = true;
    loadError.value = false;

    logger.info("[filter_list] fetchPage 发起请求", {
      page,
      pageSize,
      eventType,
      filter: currentFilter.value,
    });

    try {
      const result = await getReportInsightEvents({ page, pageSize, eventType });
      const nextItems = result.items.map(toInsightItem);
      rawItems.value = append ? [...rawItems.value, ...result.items] : result.items;
      items.value = append ? [...items.value, ...nextItems] : nextItems;
      currentPage.value = result.page;
      hasMore.value = result.hasMore;
      logger.info("[filter_list] fetchPage 请求成功", {
        page: result.page,
        total: result.total,
        itemCount: result.items.length,
        hasMore: result.hasMore,
      });
    } catch (error) {
      logger.error("[filter_list] fetchPage 请求失败", error);
      loadError.value = true;
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  }

  async function loadInitial() {
    currentPage.value = 0;
    hasMore.value = true;
    await fetchPage(1, false);
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return;
    await fetchPage(currentPage.value + 1, true);
  }

  const visibleItems = computed(() => {
    const filter = currentFilter.value;
    if (!filter) return items.value;
    return items.value.filter((item) => {
      if (filter.deviceIds?.length && !filter.deviceIds.includes(item.deviceId)) return false;
      if (filter.eventIds?.length && !filter.eventIds.includes(item.id)) return false;
      if (!matchesEventType(filter.eventType, item.eventTypeCode)) return false;
      if (filter.statuses?.length && !filter.statuses.includes(item.status)) return false;
      if (filter.urgency === "urgent" && !item.isUrgent) return false;
      if (filter.urgency === "normal" && item.isUrgent) return false;
      return true;
    });
  });

  function applyUrgentResult(item: ReportInsightItem, result: ToggleReportInsightUrgentResult) {
    item.isUrgent = result.urgent;
    item.urgentText = formatUrgentText(result.urgent, item.ownerTag);
  }

  function findItem(target: ReportUrgentTarget) {
    return items.value.find(item => item.id === target.eventId) ?? null;
  }

  /**
   * 收到 filter_list：落条件 + 重新拉取第一页，把「筛选」变成真正的接口动作。
   * eventType（如高液压油温）随请求发给服务端，visibleItems 再做一次客户端兜底。
   */
  function setCurrentFilter(filter: ReportListFilter | null) {
    logger.info("[filter_list] setCurrentFilter 入参", {
      filter,
      currentFilter: currentFilter.value,
    });
    currentFilter.value = filter;
    void loadInitial();
  }

  /**
   * 收到 enter_insight：上一轮的筛选条件（如高液压油温的 eventType）还留在 currentFilter 里，
   * 先清空再重新拉第一页，保证进入洞察列表时看到的是全部数据。
   */
  function clearCurrentFilter() {
    const previous = currentFilter.value;
    if (!previous?.eventType?.length) {
      logger.info("[filter_list] clearCurrentFilter 跳过：无历史 eventType", { currentFilter: previous });
      return;
    }
    logger.info("[filter_list] clearCurrentFilter 清空历史筛选，重新查询全部", { previous });
    currentFilter.value = null;
    void loadInitial();
  }

  function requestUrgentConfirmation(target: ReportUrgentTarget) {
    pendingUrgentTarget.value = target;
  }

  function clearUrgentConfirmation() {
    pendingUrgentTarget.value = null;
  }

  async function toggleUrgent(item: ReportInsightItem) {
    if (item.urgentLoading) return false;
    item.urgentLoading = true;
    try {
      const result = await toggleReportInsightUrgent({ eventId: item.id });
      applyUrgentResult(item, result);
      showUrgentToast(result.urgent ? "已加急" : "已取消加急");
      return result.urgent;
    } catch {
      return false;
    } finally {
      item.urgentLoading = false;
    }
  }

  /** 索引数组载荷：越界索引直接丢弃，避免 undefined 混进批量请求。 */
  function pickItemsByIndexes(indexes: number[]) {
    return indexes
      .map(index => items.value[index])
      .filter((item): item is ReportInsightItem => Boolean(item));
  }

  /**
   * 批量分支：加急接口本身是 toggle，所以只对「状态需要翻转」的条目发请求——
   * 加急时跳过已加急项，取消时跳过未加急项，否则会把状态又翻回去。
   */
  async function applyUrgentBatch(
    targetItems: ReportInsightItem[],
    desiredUrgent: boolean,
    successToast: "已加急" | "已取消加急",
  ) {
    const actionableItems = targetItems.filter(item => item.isUrgent !== desiredUrgent && !item.urgentLoading);
    if (!actionableItems.length) {
      showUrgentToast("已处理");
      return false;
    }

    const results = await Promise.all(actionableItems.map(async (item) => {
      item.urgentLoading = true;
      try {
        const result = await toggleReportInsightUrgent({ eventId: item.id });
        applyUrgentResult(item, result);
        return result.urgent === desiredUrgent;
      } catch {
        return false;
      } finally {
        item.urgentLoading = false;
      }
    }));
    if (results.some(Boolean)) showUrgentToast(successToast);
    return results.some(Boolean);
  }

  /** 收到 execute_urgent：把未加急的条目置为加急，已加急的原样跳过。 */
  async function executeUrgent(action: UrgentAction) {
    if ("eventId" in action) {
      const item = findItem(action);
      return !item || item.isUrgent ? false : toggleUrgent(item);
    }

    if ("target" in action) {
      const item = findItem(action.target);
      return !item || item.isUrgent ? false : toggleUrgent(item);
    }

    return applyUrgentBatch(pickItemsByIndexes(action.targets), true, "已加急");
  }

  /** 收到 cancel_execute：把已加急的条目改回未加急，未加急的原样跳过。 */
  async function cancelUrgent(action: UrgentAction) {
    if ("eventId" in action) {
      const item = findItem(action);
      return !item || !item.isUrgent ? false : toggleUrgent(item);
    }

    if ("target" in action) {
      const item = findItem(action.target);
      return !item || !item.isUrgent ? false : toggleUrgent(item);
    }

    return applyUrgentBatch(pickItemsByIndexes(action.targets), false, "已取消加急");
  }

  async function confirmUrgent(confirmed: boolean, target?: ReportUrgentTarget) {
    const resolvedTarget = target ?? pendingUrgentTarget.value;
    clearUrgentConfirmation();
    return confirmed && resolvedTarget ? executeUrgent(resolvedTarget) : false;
  }

  async function onLightningTap(item: ReportInsightItem) {
    await toggleUrgent(item);
  }

  function dispose() {
    if (urgentToastTimer) clearTimeout(urgentToastTimer);
  }

  return {
    items,
    rawItems,
    visibleItems,
    loading,
    loadingMore,
    loadError,
    hasMore,
    currentFilter,
    pendingUrgentTarget,
    urgentToastVisible,
    urgentToastMessage,
    loadInitial,
    loadMore,
    setCurrentFilter,
    clearCurrentFilter,
    requestUrgentConfirmation,
    clearUrgentConfirmation,
    executeUrgent,
    cancelUrgent,
    confirmUrgent,
    onLightningTap,
    dispose,
  };
}
