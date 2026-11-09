<script setup lang="ts">
import type { PropType } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import iconPartsCamera from "@/assets/img/icon-parts-camera.svg";
import iconPartsUpload from "@/assets/img/icon-parts-upload.svg";

/**
 * 附件来源弹窗。
 *
 * - variant="design"：设计稿 1321:39「点击+号弹窗」的底部面板 ——
 *   白底 22px 顶角圆角 + 两行 64px 大按钮（拍照识配件 / 上传识配件），输入栏左侧「+」用这个；
 * - variant="legacy"：居中文字弹窗（添加附件 / 拍照 / 从相册选择 / 选择文件），
 *   指导步骤卡的附件按钮沿用，功能不变。
 *
 * 容器内原生选择器可用时步骤卡不弹它（原生弹窗本身就有这三项）。
 */
defineOptions({ name: "AiAttachmentPicker" });

const props = defineProps({
  visible: { type: Boolean, default: false },
  variant: { type: String as PropType<"legacy" | "design">, default: "legacy" },
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "pick", source: "camera" | "album" | "file"): void;
}>();

const { t } = useI18n();

const isDesign = computed(() => props.variant === "design");

/**
 * 设计稿两行的文案与图标：
 * 拍照识配件（打开相机识别配件）/ 上传识配件（上传本地图片识别配件）。
 * 「上传」这一行落到相册选图，不再单独提供「选择文件」。
 */
const designOptions = computed(() => [
  {
    source: "camera" as const,
    icon: iconPartsCamera,
    title: t("attachment-parts-photo"),
    desc: t("attachment-parts-photo-desc"),
  },
  {
    source: "album" as const,
    icon: iconPartsUpload,
    title: t("attachment-parts-upload"),
    desc: t("attachment-parts-upload-desc"),
  },
]);

function close() {
  emit("update:visible", false);
}

function pick(source: "camera" | "album" | "file") {
  emit("pick", source);
}
</script>

<template>
  <!--
    挂到 body：弹窗必须真正压在页面最上层。
    调用方（.chat-input 输入栏、步骤卡）自己都是层叠上下文（fixed + z-index），
    弹窗留在里面时下面的 1020 只在该上下文内比大小 —— 底部输入栏胶囊、快捷入口胶囊
    （AiChatNav）都是它的兄弟节点，会反过来盖住白色面板。
  -->
  <Teleport to="body">
    <view
      v-if="visible"
      class="attachment-picker-mask"
      :class="{ 'attachment-picker-mask--sheet': isDesign }"
      @tap.stop="close"
    >
      <!-- 设计稿 1321:39：底部面板，无标题、无取消，点空白处收起 -->
      <view v-if="isDesign" class="attachment-sheet" @tap.stop>
        <view
          v-for="item in designOptions"
          :key="item.source"
          class="attachment-sheet__item"
          @tap="pick(item.source)"
        >
          <image class="attachment-sheet__icon" :src="item.icon" mode="aspectFit" />
          <view class="attachment-sheet__text">
            <text class="attachment-sheet__title">{{ item.title }}</text>
            <text class="attachment-sheet__desc">{{ item.desc }}</text>
          </view>
        </view>
      </view>

      <!-- 步骤卡沿用的居中弹窗，样式与文案保持原样 -->
      <view v-else class="attachment-picker" @tap.stop>
        <view class="attachment-picker__title"> 添加附件 </view>
        <view class="attachment-picker__btn" @tap="pick('camera')"> 拍照 </view>
        <view class="attachment-picker__btn" @tap="pick('album')">
          从相册选择
        </view>
        <view class="attachment-picker__btn" @tap="pick('file')"> 选择文件 </view>
        <view class="attachment-picker__cancel" @tap="close"> 取消 </view>
      </view>
    </view>
  </Teleport>
</template>

<style lang="scss" scoped>
/* ---------- 附件来源弹窗 ---------- */
/* 弹窗已 Teleport 到 body，这里的 z-index 是在页面层参与比较：
   必须高于底部卡片（步骤卡 / 追问卡 / 多选项抽屉都是 1002），从卡片里唤起时要压住卡片；
   也必须高于 ai-chat-header（1010）与输入栏 / 底部导航（1）——
   否则遮罩盖不住头部，白色面板还会被底部的快捷入口胶囊压住。
   仍低于全屏弹窗（分享 1030 / 设置 1200），那些场景由它们自己置顶 */
.attachment-picker-mask {
  position: fixed;
  z-index: 1020;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

/* 设计稿面板不压暗页面：保留一层透明点击区，点面板以外的地方收起 */
.attachment-picker-mask--sheet {
  align-items: flex-end;
  background: transparent;
}

/* 设计稿 1321:39 Rectangle 25：375×203、顶角 22px、白底、上抛投影 y-2 / blur21 / 6% */
.attachment-sheet {
  width: 100%;
  box-sizing: border-box;
  /* 面板内左右各 40px（两行按钮 295 宽居中），顶部 26px */
  padding: 52rpx 80rpx 0;
  /* 两行按钮离屏幕底再抬一档：无安全区的机型（安卓 WebView）原本只剩 5px，太贴底 */
  padding-bottom: calc(48rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 44rpx 44rpx 0 0;
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
}

/* 设计稿 Rectangle 102：295×64、r12、#F6F6F6，图标左内边距 18px */
.attachment-sheet__item {
  display: flex;
  align-items: center;
  height: 128rpx;
  padding-left: 36rpx;
  box-sizing: border-box;
  border-radius: 24rpx;
  background: #f6f6f6;

  & + & {
    margin-top: 20rpx;
  }

  &:active {
    background: #efefef;
  }
}

.attachment-sheet__icon {
  width: 64rpx;
  height: 64rpx;
  flex-shrink: 0;
}

/* 图标右边缘到文案 11px：标题 14px #1A1A1A，副标题 12px #999999，间隔 2px */
.attachment-sheet__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-left: 22rpx;
}

.attachment-sheet__title {
  color: #1a1a1a;
  font-size: 28rpx;
  line-height: 40rpx;
}

.attachment-sheet__desc {
  margin-top: 4rpx;
  color: #999999;
  font-size: 24rpx;
  line-height: 34rpx;
}

/* ---------- 居中弹窗（步骤卡） ---------- */
.attachment-picker {
  width: 560rpx;
  border-radius: 24rpx;
  background: #ffffff;
  overflow: hidden;
}

.attachment-picker__title {
  padding: 32rpx 0 20rpx;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 36rpx;
  text-align: center;
}

.attachment-picker__btn,
.attachment-picker__cancel {
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx; // 15px
  line-height: 40rpx;
  border-top: 1rpx solid #f0f0f0;
  box-sizing: border-box;

  &:active {
    background: #f5f5f5;
  }
}

.attachment-picker__btn {
  color: #1a1a1a;
}

.attachment-picker__cancel {
  color: #999999;
}
</style>
