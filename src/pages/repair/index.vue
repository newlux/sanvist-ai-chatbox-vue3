<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";

/**
 * 故障维修页：内嵌三方 H5。
 * 入口 URL 由 sanvist H5 加密脚本本地生成，不走业务对话链路。
 */
defineOptions({ name: "AiRepairPage" });

const logger = createLogger("repair-page");
const userStore = useUserStore();
const { safeTopPx, safeBottomPx } = useSafeArea();
const embedUrl = ref("");
const loadError = ref("");

const iframeSrc = computed(() => embedUrl.value);
const embedStyle = computed(() => ({
  paddingTop: `${safeTopPx.value}px`,
  paddingBottom: `${safeBottomPx.value}px`,
}));

function buildEmbedUrl() {
  try {
    const result = buildSanvistH5Url({
      externalUserId: String(userStore.userId || "").trim() || undefined,
      name: String(userStore.username || "").trim() || undefined,
    });
    embedUrl.value = result.url;
    loadError.value = "";
    logger.info("sanvist h5 url ready", result.payload);
  }
  catch (error) {
    loadError.value = "三方页面加载失败";
    logger.error("failed to build sanvist h5 url", error);
  }
}

onMounted(buildEmbedUrl);
</script>

<template>
  <view class="ai-page">
    <view class="ai-page__embed" :style="embedStyle">
      <text v-if="loadError" class="ai-page__error">
        {{ loadError }}
      </text>
      <iframe
        v-else-if="iframeSrc"
        class="ai-page__iframe"
        :src="iframeSrc"
        frameborder="0"
        allow="microphone; camera; autoplay; clipboard-write"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: #fafafa;
}

.ai-page__embed {
  position: relative;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  background: #fff;
}

.ai-page__iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.ai-page__error {
  display: block;
  padding: 48rpx 40rpx;
  color: #6b6b6b;
  font-size: 28rpx;
  text-align: center;
}
</style>
