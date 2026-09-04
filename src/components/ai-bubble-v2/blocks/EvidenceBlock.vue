<script setup lang="ts">
import { computed, ref } from "vue";
import { formatFileSize } from "@/hooks/useComposerAttachments";

defineOptions({ name: "EvidenceBlock" });

const props = defineProps({
  items: { type: Array, default: () => [] },
});

type EvidenceKind = "image" | "file" | "text";

interface NormalizedEvidence {
  kind: EvidenceKind;
  /** 图片预览 / 文件链接地址（可能为空） */
  url: string;
  /** 文件名 / 标题 */
  name: string;
  sizeText: string;
  /** 文本引用摘要（chunk 等） */
  summary: string;
  /** 列表徽标：文件扩展名，无扩展名时用占位文案 */
  marker: string;
}

/** Guide 后端 evidence 项的可选字段；按常见命名兼容，字段不存在就当脏数据处理 */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#]|$)/i;
const DOC_EXT_RE = /\.([a-z0-9]{1,6})(?:[?#]|$)/i;

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function lastExtension(path: string): string {
  const match = String(path || "").match(DOC_EXT_RE);
  return match ? match[1].toLowerCase() : "";
}

function normalizeItems(raw: unknown): NormalizedEvidence[] {
  if (!Array.isArray(raw)) return [];
  const result: NormalizedEvidence[] = [];

  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const source = entry as Record<string, unknown>;

    const type = String(source.type ?? source.kind ?? "").toLowerCase();
    const url = pickString(source, ["url", "image_url", "file_url", "preview_url", "thumbnail"]);
    const name = pickString(source, ["name", "file_name", "title"]);
    const summary = pickString(source, ["chunk", "content", "description", "text"]);
    const mime = String(source.mime_type ?? source.mimeType ?? "").toLowerCase();
    const declaredExt = String(source.extension ?? "").toLowerCase();
    const pathExt = lastExtension(url) || lastExtension(name);
    const ext = declaredExt || pathExt;
    const sizeText = formatFileSize(Number(source.size) || 0);

    const isImage =
      ["image", "img", "picture", "图片"].includes(type)
      || mime.startsWith("image/")
      || (url && IMAGE_EXT_RE.test(url))
      || (ext && IMAGE_EXT_RE.test(`.${ext}`));
    if (isImage) {
      // 判定是图片却没有可渲染地址，无法展示，跳过
      if (url) {
        result.push({
          kind: "image",
          url,
          name: name || "图片",
          sizeText: "",
          summary: "",
          marker: "",
        });
      }
      return;
    }

    const isFile =
      Boolean(url)
      || ["file", "document", "doc", "docx", "pdf", "word", "excel", "attachment"].includes(type)
      || Boolean(ext);
    if (isFile) {
      result.push({
        kind: "file",
        url,
        name: name || (ext ? `附件.${ext}` : "附件"),
        sizeText,
        summary,
        marker: (ext || "").toUpperCase().slice(0, 4) || "档",
      });
      return;
    }

    // 剩下的是纯文本引用（chunk_id + chunk 之类），按摘要列表展示
    if (summary) {
      result.push({
        kind: "text",
        url: "",
        name,
        sizeText: "",
        summary,
        marker: "",
      });
    }
  });

  return result;
}

const normalized = computed(() => normalizeItems(props.items));

/** 图片加载失败的下标集合：破图直接隐藏，不占位也不弹错误 */
const brokenImageIndexes = ref<number[]>([]);
const imageList = computed(() =>
  normalized.value
    .map((item, index) => ({ ...item, index }))
    .filter(item => item.kind === "image" && !brokenImageIndexes.value.includes(item.index)),
);

function onImageError(index: number) {
  if (!brokenImageIndexes.value.includes(index)) {
    brokenImageIndexes.value = [...brokenImageIndexes.value, index];
  }
}

function onPreviewImage(url: string) {
  const urls = imageList.value.map(item => item.url).filter(Boolean);
  if (!urls.length) return;
  uni.previewImage({ current: url, urls });
}

async function copyValue(value: string) {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    if (typeof uni !== "undefined" && typeof uni.setClipboardData === "function") {
      await new Promise<void>((resolve, reject) => {
        uni.setClipboardData({ data: text, success: () => resolve(), fail: () => reject() });
      });
      return true;
    }
  } catch {
    // 回退到浏览器剪贴板
  }
  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略
  }
  return false;
}

async function onItemTap(item: NormalizedEvidence) {
  if (item.url) {
    const copied = await copyValue(item.url);
    uni.showToast({ title: copied ? "链接已复制" : "复制失败", icon: "none", duration: 1500 });
    return;
  }
  if (item.summary) {
    const copied = await copyValue(item.summary);
    uni.showToast({ title: copied ? "内容已复制" : "复制失败", icon: "none", duration: 1500 });
  }
}
</script>

<template>
  <view v-if="normalized.length" class="evidence-block">
    <view class="evidence-block__header">
      <view class="evidence-block__header-bar" />
      <text class="evidence-block__header-text">参考资料</text>
    </view>

    <!-- 图片：宽度 100%，留白由容器 padding 承担，高度随宽度自适应 -->
    <template v-for="(item, index) in imageList" :key="`image-${index}`">
      <image
        class="evidence-block__image"
        mode="widthFix"
        :src="item.url"
        :show-menu-by-longpress="false"
        @tap="onPreviewImage(item.url)"
        @error="onImageError(item.index)"
      />
    </template>

    <!-- 文件 / 文本引用：竖排列表 -->
    <view v-if="normalized.some(item => item.kind !== 'image')" class="evidence-block__list">
      <view
        v-for="(item, index) in normalized.filter(item => item.kind !== 'image')"
        :key="`row-${index}`"
        class="evidence-block__row"
        :class="{ 'evidence-block__row--file': item.kind === 'file' }"
        hover-class="evidence-block__row--hover"
        @tap="onItemTap(item)"
      >
        <view v-if="item.kind === 'file'" class="evidence-block__marker">
          <text class="evidence-block__marker-text">{{ item.marker }}</text>
        </view>
        <view class="evidence-block__body">
          <view class="evidence-block__headline">
            <text v-if="item.name" class="evidence-block__name">
              {{ item.name }}
            </text>
            <text v-if="item.kind === 'file' && item.sizeText" class="evidence-block__size">
              {{ item.sizeText }}
            </text>
          </view>
          <text v-if="item.summary" class="evidence-block__summary">
            {{ item.summary }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.evidence-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  // 与答案卡片拉开一点距离；padding 同时充当图片两侧留白
  margin-top: 20rpx;
  padding: 20rpx 28rpx;
  border-radius: 20rpx;
  background: #f9f9f9;
}

.evidence-block__header {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 20rpx;
}

.evidence-block__header-bar {
  width: 6rpx;
  height: 24rpx;
  border-radius: 3rpx;
  background: #f12832;
}

.evidence-block__header-text {
  color: #8a919f;
  font-size: 24rpx;
  line-height: 34rpx;
}

.evidence-block__image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
  background: #eef0f3;
}

.evidence-block__list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.evidence-block__row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  width: 100%;
  min-width: 0;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #eef0f3;
  box-sizing: border-box;
}

.evidence-block__row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.evidence-block__row--hover {
  opacity: 0.7;
}

.evidence-block__marker {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 12rpx;
  background: #e8ebf1;
  color: #5f6775;
  padding: 0 6rpx;
  box-sizing: border-box;
}

.evidence-block__marker-text {
  font-size: 20rpx;
  line-height: 24rpx;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.evidence-block__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding-top: 2rpx;
}

.evidence-block__headline {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  min-width: 0;
}

.evidence-block__name {
  color: #2f323c;
  font-size: 28rpx;
  line-height: 40rpx;
  font-weight: 500;
  word-break: break-all;
}

.evidence-block__size {
  flex: none;
  color: #9aa0aa;
  font-size: 22rpx;
  line-height: 34rpx;
}

.evidence-block__summary {
  color: #5f6775;
  font-size: 24rpx;
  line-height: 36rpx;
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
</style>
