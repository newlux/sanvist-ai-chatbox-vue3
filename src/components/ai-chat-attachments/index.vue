<script setup lang="ts">
import type { ComposerAttachment } from "@/hooks/useComposerAttachments";
import { formatAttachmentStatus } from "@/hooks/useComposerAttachments";

defineProps<{ attachments: ComposerAttachment[] }>();

const emit = defineEmits<{
  remove: [localId: string];
  retry: [localId: string];
}>();

/**
 * 点击附件：失败态触发重传（低版本降级路径），
 * 其余图片点击弹出大图预览（优先用可内联显示的 COS 预签名地址）。
 */
function onItemTap(attachment: ComposerAttachment) {
  if (attachment.status === "failed") {
    emit("retry", attachment.localId);
    return;
  }
  if (attachment.type === "image") {
    uni.previewImage({
      urls: [attachment.previewPath || attachment.url || attachment.localPath],
      current: 0,
    });
  }
}

/** 图片加载失败时打印排查（预签名地址失效 / 防盗链 / 404 等） */
function onImageError(attachment: ComposerAttachment) {
  console.warn("[attachment] image load failed", {
    name: attachment.name,
    url: attachment.url,
    previewPath: attachment.previewPath,
    localPath: attachment.localPath,
  });
}

/** 图片加载成功：确认最终生效的是哪个地址（预签名 / url / 本地） */
function onImageLoad(attachment: ComposerAttachment) {
  console.log("[attachment] image load success", {
    name: attachment.name,
    src: attachment.previewPath || attachment.url || attachment.localPath,
    from: attachment.previewPath ? "previewPath(cos 预签名)" : "url/localPath",
  });
}
</script>

<template>
  <scroll-view class="attachments" scroll-x :show-scrollbar="false">
    <view class="attachments__track">
      <view
        v-for="attachment in attachments"
        :key="attachment.localId"
        class="attachments__item"
        :class="[
          `attachments__item--${attachment.status}`,
          { 'attachments__item--image': attachment.type === 'image' },
        ]"
        @tap="onItemTap(attachment)"
      >
        <image
          v-if="attachment.type === 'image'"
          class="attachments__thumb"
          mode="aspectFill"
          :src="attachment.previewPath || attachment.url || attachment.localPath"
          @load="onImageLoad(attachment)"
          @error="onImageError(attachment)"
        />
        <view
          v-if="attachment.type === 'image' && attachment.status !== 'uploaded'"
          class="attachments__mask"
        >
          <text>{{ attachment.status === 'failed' ? '重试' : '上传中' }}</text>
        </view>
        <!-- 独立 v-if，不能用 v-else：遮罩也是 v-if，v-else 会绑到它上面，
             导致图片上传完成后缩略图与文件图标同时渲染 -->
        <view v-if="attachment.type !== 'image'" class="attachments__file-icon">
          <image src="@/assets/img/icon-form.svg" mode="aspectFit" />
        </view>

        <view v-if="attachment.type !== 'image'" class="attachments__info">
          <text class="attachments__name">
            {{ attachment.name }}
          </text>
          <text class="attachments__meta">
            {{ formatAttachmentStatus(attachment) }}
          </text>
        </view>

        <view class="attachments__remove" @tap.stop="emit('remove', attachment.localId)">
          <text class="attachments__remove-text">
            ×
          </text>
        </view>
      </view>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
.attachments {
  width: 100%;
  padding: 0 40rpx 12rpx;
  box-sizing: border-box;
  white-space: nowrap;
  text-align: left;
}

.attachments__track {
  display: inline-flex;
  align-items: center;
  padding: 4rpx 0;
}

.attachments__item {
  position: relative;
  flex-shrink: 0;
  width: 260rpx;
  height: 96rpx;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  // 间距不用 gap：部分小程序 webview 的 inline-flex 不支持
  margin-right: 16rpx;
  padding: 12rpx 36rpx 12rpx 12rpx;
  overflow: hidden;
  border: 1rpx solid rgba(73, 89, 117, 0.12);
  border-radius: 18rpx;
  background: #f5f5f5;

  &:last-child {
    margin-right: 0;
  }

  &--image {
    width: 112rpx;
    height: 112rpx;
    padding: 0;
  }

  &--failed {
    border-color: rgba(254, 0, 0, 0.32);
    background: #fff7f7;
  }
}

.attachments__thumb {
  width: 112rpx;
  height: 112rpx;
  border-radius: 18rpx;
  // 图片加载失败/未加载时不再纯白，给个占位底色避免"空白"误判
  background: #ececec;
}

.attachments__file-icon {
  width: 60rpx;
  height: 60rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  background: #ffffff;

  image {
    width: 36rpx;
    height: 36rpx;
  }
}

.attachments__info {
  flex: 1;
  min-width: 0;
  margin-left: 12rpx;
  display: flex;
  flex-direction: column;
}

.attachments__name,
.attachments__meta {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.attachments__name {
  font-size: 24rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #1a1a1a;
}

.attachments__meta {
  margin-top: 2rpx;
  font-size: 20rpx;
  line-height: 28rpx;
  color: #999999;
}

.attachments__item--failed .attachments__meta {
  color: #fe0000;
}

.attachments__mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18rpx;
  background: rgba(20, 25, 34, 0.48);
  color: #ffffff;
  font-size: 22rpx;
}

.attachments__remove {
  position: absolute;
  z-index: 2;
  top: 6rpx;
  right: 6rpx;
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(41, 47, 57, 0.72);
}

.attachments__remove-text {
  color: #ffffff;
  font-size: 24rpx;
  line-height: 24rpx;
}
</style>
