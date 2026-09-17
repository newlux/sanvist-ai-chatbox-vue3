import type { ReportInsightEvent, ToggleReportInsightUrgentResult } from "@/api/report-insight";
import type { ReportListFilter, ReportUrgentTarget } from "@/utils/ai-stream";
import { computed, ref } from "vue";
import { getReportInsightEvents, toggleReportInsightUrgent } from "@/api/report-insight";

const DEFAULT_PAGE_SIZE = 10;

export interface ReportInsightItem {
  id: string;
  deviceId: string;
  title: string;
  description: string;
  ownerTag: string;
  status: string;
  urgentText?: string;
  isUrgent: boolean;
  urgentLoading: boolean;
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

  function showUrgentToast(message: "已加急" | "已取消加急") {
    urgentToastMessage.value = message;
    urgentToastVisible.value = true;
    if (urgentToastTimer) clearTimeout(urgentToastTimer);
    urgentToastTimer = setTimeout(() => {
      urgentToastVisible.value = false;
      urgentToastTimer = undefined;
    }, 2000);
  }

  async function fetchPage(page: number, append: boolean) {
    if (isLoading.value) return;
    if (append) loadingMore.value = true;
    else loading.value = true;
    loadError.value = false;

    try {
      const result = await getReportInsightEvents({ page, pageSize });
      const nextItems = result.items.map(toInsightItem);
      rawItems.value = append ? [...rawItems.value, ...result.items] : result.items;
      items.value = append ? [...items.value, ...nextItems] : nextItems;
      currentPage.value = result.page;
      hasMore.value = result.hasMore;
    } catch {
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

  function setCurrentFilter(filter: ReportListFilter | null) {
    currentFilter.value = filter;
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

  async function executeUrgent(target: ReportUrgentTarget) {
    const item = findItem(target);
    return !item || item.isUrgent ? false : toggleUrgent(item);
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
    requestUrgentConfirmation,
    clearUrgentConfirmation,
    executeUrgent,
    confirmUrgent,
    onLightningTap,
    dispose,
  };
}
