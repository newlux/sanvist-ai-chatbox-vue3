<script setup lang="ts">
import type { AppearanceMode } from "@/stores";
import type { PropType } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import iconAppearance from "@/assets/img/icon-settings-appearance.svg";
import iconChevron from "@/assets/img/icon-settings-chevron.svg";
import iconLanguage from "@/assets/img/icon-settings-language.svg";
import iconMemory from "@/assets/img/icon-settings-memory.svg";
import iconTimbre from "@/assets/img/icon-settings-timbre.svg";
import { useSystemStore } from "@/stores";

/**
 * 设置弹层（设计稿 722:2800「设置」）。
 *
 * 结构对应设计稿：
 * - 722:2803 全屏遮罩 `#0D0D0D` 40% 不透明度；
 * - 722:2804 底部弹层 375×332、顶角 20px 圆角、纯白、无投影；
 * - 722:2867 四行设置项（记忆 / 语言 / 外观 / 音色），行间 28px；
 * - 857:118 底部《个人信息清单》《三方信息共享清单》链接。
 *
 * 「记忆」「音色」目前只有 UI 状态：memoryEnabled 为本地交互态，
 * 音色二级页尚未提供，所以音色行只做展示；语言接全局 i18n，外观接 system store（决定深色主题）。
 */
defineOptions({ name: "AiSettingsSheet" });

type AppLanguage = "zh_CN" | "en_US";

const props = defineProps({
  visible: { type: Boolean, default: false },
  language: { type: String as PropType<AppLanguage>, default: "zh_CN" },
  /**
   * 深色主题（首页问答态）：弹层底色 / 文字 / 分段控件换深色材质。
   * 设计稿 722:2800 只有浅色稿，深色按历史抽屉（Ardot 1193:3855）同一套暗色梯度推：
   * 弹层 #1A1A1A、分段轨道 #212121、选中项白底黑字、文案白、黑色图标反相，
   * 尺寸 / 间距 / 圆角 / 遮罩（本就是 rgba(13,13,13,0.4)）一律不动。
   */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "update:language", value: AppLanguage): void;
}>();

const { t } = useI18n();
const systemStore = useSystemStore();

/** 设计稿 722:2873 是开启态；本地交互态，暂不落存储、不接接口 */
const memoryEnabled = ref(true);

const appearanceOptions: Array<{ value: AppearanceMode; label: string }> = [
  { value: "system", label: "settings-appearance-system" },
  { value: "light", label: "settings-appearance-light" },
  { value: "dark", label: "settings-appearance-dark" },
];

function close() {
  emit("update:visible", false);
}

function selectLanguage(value: AppLanguage) {
  if (value === props.language) return;
  emit("update:language", value);
}
</script>

<template>
  <view v-if="visible" class="settings-sheet__mask" :class="{ 'settings-sheet__mask--dark': dark }" @tap.stop="close">
    <!-- 设计稿 722:2804 Rectangle 144：底部弹层，顶角 20px（40rpx）圆角，纯白，无阴影 -->
    <view class="settings-sheet" @tap.stop>
      <!-- 设计稿 722:2867 Frame 98：四行设置项，垂直排列，行间 28px（56rpx） -->
      <view class="settings-sheet__rows">
        <!-- 设计稿 722:2818：记忆 + 722:2873 开关 -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconMemory" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-memory") }}</text>
          <view
            class="settings-sheet__switch"
            :class="{ 'settings-sheet__switch--off': !memoryEnabled }"
            @tap.stop="memoryEnabled = !memoryEnabled"
          >
            <view class="settings-sheet__switch-thumb" />
          </view>
        </view>

        <!-- 设计稿 722:2817：语言 + 722:2998 中文 / EN 分段 -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconLanguage" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-language") }}</text>
          <view class="settings-sheet__segment">
            <view
              class="settings-sheet__segment-item"
              :class="{ 'settings-sheet__segment-item--active': language === 'zh_CN' }"
              @tap.stop="selectLanguage('zh_CN')"
            >
              中文
            </view>
            <view
              class="settings-sheet__segment-item"
              :class="{ 'settings-sheet__segment-item--active': language === 'en_US' }"
              @tap.stop="selectLanguage('en_US')"
            >
              EN
            </view>
          </view>
        </view>

        <!-- 设计稿 722:2832：外观 + 722:2999 系统 / 浅色 / 深色分段 -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconAppearance" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-appearance") }}</text>
          <view class="settings-sheet__segment">
            <view
              v-for="option in appearanceOptions"
              :key="option.value"
              class="settings-sheet__segment-item"
              :class="{ 'settings-sheet__segment-item--active': systemStore.appearance === option.value }"
              @tap.stop="systemStore.setAppearance(option.value)"
            >
              {{ t(option.label) }}
            </view>
          </view>
        </view>

        <!-- 设计稿 873:1308：音色 + 873:1319 进入箭头（二级页未提供，暂不绑定跳转） -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconTimbre" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-timbre") }}</text>
          <image class="settings-sheet__chevron" :src="iconChevron" mode="aspectFit" />
        </view>
      </view>

      <!-- 设计稿 857:118：《个人信息清单》《三方信息共享清单》14px Medium #1166D6 -->
      <!-- <text class="settings-sheet__links">{{ t("settings-privacy-links") }}</text> -->
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 设计稿 722:2803 Rectangle 4：全屏遮罩，#0D0D0D + 40% 不透明度 */
.settings-sheet__mask {
  position: fixed;
  z-index: 1200;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(13, 13, 13, 0.4);
}

/* 设计稿 722:2804 Rectangle 144：375×332（664rpx 高）、顶角 20px（40rpx）、#FFFFFF、无投影
   内边距：上 32.5px（65rpx）、左右 30px（60rpx）、下 47px（94rpx，链接底到屏幕底） */
.settings-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 664rpx;
  box-sizing: border-box;
  padding: 65rpx 60rpx 94rpx;
  border-radius: 40rpx 40rpx 0 0;
  background: #ffffff;
}

/* 设计稿 722:2867 Frame 98：垂直 auto layout，gap 28px（56rpx） */
.settings-sheet__rows {
  display: flex;
  flex-direction: column;
  gap: 56rpx;
}

/* 行高由内容撑开：记忆/音色 28px、语言/外观 34px；图标 28px（56rpx），图标到文字 10px（20rpx） */
.settings-sheet__row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

/* 设计稿 722:2863 / 722:2851 / 722:2857 / 873:1309：28×28（56rpx）单色图标 */
.settings-sheet__icon {
  width: 56rpx;
  height: 56rpx;
  flex-shrink: 0;
}

/* 设计稿 722:2824 / 722:2805 / 722:2835 / 873:1313：18px（36rpx）/ Regular / #0D0D0D，行高 26px
   label 只吃剩余宽度：分段（尤其英文）撑开后不再换行，极端窄屏才省略 */
.settings-sheet__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #0d0d0d;
  font-size: 36rpx;
  font-weight: 400;
  line-height: 52rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 设计稿 722:2873：44×22（88×44rpx）轨道，圆角 11px（22rpx），#1166D6 */
.settings-sheet__switch {
  position: relative;
  flex-shrink: 0;
  width: 88rpx;
  height: 44rpx;
  border-radius: 22rpx;
  background: #1166d6;
}

/* 设计稿 722:2872：18×18（36rpx）白色滑块，轨道内右侧距边 2px（4rpx） */
.settings-sheet__switch-thumb {
  position: absolute;
  top: 4rpx;
  right: 4rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: #ffffff;
}

/* 设计稿只给了开启态；关闭态用中性灰补充，待设计确认 */
.settings-sheet__switch--off {
  background: #d9d9d9;
}

.settings-sheet__switch--off .settings-sheet__switch-thumb {
  right: auto;
  left: 4rpx;
}

/* 设计稿 722:2998 / 722:2999 Frame 99：轨道 #F3F3F3、圆角 10px（20rpx）、padding 3/3/2/2、分段间距 2px */
.settings-sheet__segment {
  display: flex;
  flex-shrink: 0;
  gap: 4rpx;
  padding: 4rpx 6rpx;
  border-radius: 20rpx;
  background: #f3f3f3;
}

/* 设计稿 722:2992 等：分段 46×30（92×60rpx）为最小尺寸、圆角 10px；未选中 #F3F3F3 底 + #5D5D5D 文字
   宽度不再写死：中文按 92rpx 起，英文（System / Light / Dark）文案更长时由内容撑开，
   左右各留 12rpx 内边距，避免长文案贴边 */
.settings-sheet__segment-item {
  display: flex;
  box-sizing: border-box;
  min-width: 92rpx;
  height: 60rpx;
  align-items: center;
  justify-content: center;
  padding: 0 12rpx;
  border-radius: 20rpx;
  background: #f3f3f3;
  color: #5d5d5d;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 44rpx;
  white-space: nowrap;
}

/* 选中：白底 + #0D0D0D 文字 */
.settings-sheet__segment-item--active {
  background: #ffffff;
  color: #0d0d0d;
}

/* 设计稿 873:1319 Collapse：24×24（48rpx）进入箭头，描边 #0D0D0D */
.settings-sheet__chevron {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

/* 设计稿 857:118：14px（28rpx）/ Medium(500) / #1166D6，行高 20px（40rpx） */
.settings-sheet__links {
  margin-top: auto;
  color: #1166d6;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
}

/* ===== 深色主题：设置弹层（首页问答态）=====
   设计稿 722:2800 只有浅色稿，深色按历史抽屉 Ardot 1193:3855 的同一套材质推，
   尺寸 / 间距 / 圆角 / 动效不动：
   - 弹层 722:2804：底 #212121（与回复卡同材质），顶角 40rpx 圆角、无投影不变
   - 遮罩 722:2803：rgba(13,13,13,0.4)，两稿同值，不改
   - 四行文案 722:2824 等：#0D0D0D → #FFFFFF；黑色图标反相为白
   - 分段 722:2998 / 722:2999：轨道 #F3F3F3 → #303030（比弹层亮一阶才看得出分段），
     未选中文字 #8F8F8F，选中项黑白反转（#FFFFFF 底 + #0D0D0D 字）
   - 开关 722:2873：开启仍是品牌蓝 #1166D6，关闭态 #D9D9D9 → #303030
   - 底部链接 857:118：保留品牌蓝 #1166D6（设计稿未给深色值，不臆造） */
.settings-sheet__mask--dark {
  .settings-sheet {
    background: #212121;
  }

  .settings-sheet__label {
    color: #ffffff;
  }

  // 记忆 / 语言 / 外观 / 音色 / 箭头都是纯黑矢量，深底下反相成白
  .settings-sheet__icon,
  .settings-sheet__chevron {
    filter: brightness(0) invert(1);
  }

  .settings-sheet__switch--off {
    background: #303030;
  }

  .settings-sheet__segment {
    background: #303030;
  }

  .settings-sheet__segment-item {
    background: transparent;
    color: #8f8f8f;
  }

  .settings-sheet__segment-item--active {
    background: #ffffff;
    color: #0d0d0d;
  }
}
</style>
