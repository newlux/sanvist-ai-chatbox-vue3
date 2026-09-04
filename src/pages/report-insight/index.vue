<script setup lang="ts">
import type { ReportInsightItem } from "@/hooks/useReportInsights";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import ReportInsight from "@/components/report-broadcast-player/report-insight.vue";
import { useReportInsights } from "@/hooks/useReportInsights";
import { useUserStore } from "@/stores";

defineOptions({ name: "ReportInsightPage" });

const inputText = ref("");
const userStore = useUserStore();
const canToggleUrgent = computed(() => userStore.visitorRole === "OWNER");
const {
  items,
  loading,
  urgentToastVisible,
  loadingMore,
  hasMore,
  loadInitial,
  loadMore,
  onLightningTap,
  dispose,
} = useReportInsights();

function closeInsight() {
  uni.navigateBack({ delta: 1 });
}

function openOperatorItem(item: ReportInsightItem) {
  uni.navigateTo({
    url: `/pages/chat/index?subagent=${encodeURIComponent("task")}&eventId=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`,
  });
}

onMounted(loadInitial);
onBeforeUnmount(dispose);
</script>

<template>
  <view class="report-insight-page">
    <ReportInsight
      :items="items"
      :loading="loading"
      :can-toggle-urgent="canToggleUrgent"
      :urgent-toast-visible="urgentToastVisible"
      :loading-more="loadingMore"
      :has-more="hasMore"
      @close="closeInsight"
      @operator-item-open="openOperatorItem"
      @urgent-toggle="onLightningTap"
      @load-more="loadMore"
    />
    <AiChatInput v-model="inputText" />
  </view>
</template>

<style scoped lang="scss">
.report-insight-page {
  width: 100%;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
</style>
