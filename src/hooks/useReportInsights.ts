import type { ReportInsightEvent, ToggleReportInsightUrgentResult } from "@/api/report-insight";
import { computed, ref } from "vue";
import { getReportInsightEvents, toggleReportInsightUrgent } from "@/api/report-insight";

const DEFAULT_PAGE_SIZE = 10;

export interface ReportInsightItem {
  id: string;
  title: string;
  description: string;
  ownerTag: string;
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
    title: `${event.eventCategory}-${event.eventType}`,
    description: event.description,
    ownerTag: event.ownerTag,
    urgentText: formatUrgentText(event.urgent, event.ownerTag),
    isUrgent: event.urgent,
    urgentLoading: false,
  };
}

export function useReportInsights(pageSize = DEFAULT_PAGE_SIZE) {
  const items = ref<ReportInsightItem[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loadError = ref(false);
  const currentPage = ref(0);
  const hasMore = ref(true);
  const urgentToastVisible = ref(false);
  let urgentToastTimer: ReturnType<typeof setTimeout> | undefined;

  const isLoading = computed(() => loading.value || loadingMore.value);

  function showUrgentToast() {
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

  function applyUrgentResult(item: ReportInsightItem, result: ToggleReportInsightUrgentResult) {
    item.isUrgent = result.urgent;
    item.urgentText = formatUrgentText(result.urgent, item.ownerTag);
  }

  async function onLightningTap(item: ReportInsightItem) {
    if (item.urgentLoading) return;
    item.urgentLoading = true;
    try {
      const result = await toggleReportInsightUrgent({ eventId: item.id });
      applyUrgentResult(item, result);
      if (result.urgent) showUrgentToast();
    } catch {
      // 请求失败时保留服务端已确认的旧状态。
    } finally {
      item.urgentLoading = false;
    }
  }

  function dispose() {
    if (urgentToastTimer) clearTimeout(urgentToastTimer);
  }

  return {
    items,
    loading,
    loadingMore,
    loadError,
    hasMore,
    urgentToastVisible,
    loadInitial,
    loadMore,
    onLightningTap,
    dispose,
  };
}
