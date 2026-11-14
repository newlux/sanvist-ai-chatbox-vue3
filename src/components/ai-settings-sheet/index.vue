<script setup lang="ts">
// 「对话」入口暂时隐藏，恢复时放开（dialogOptions / selectDialogMode 用得到）
// import type { SettingsDialogueMode } from "@/api/settings/types";
import type { AppearanceMode } from "@/stores";
import type { PropType } from "vue";
import { storeToRefs } from "pinia";
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import iconAppearance from "@/assets/img/icon-settings-appearance.svg";
import iconChevron from "@/assets/img/icon-settings-chevron.svg";
// 「对话」入口暂时隐藏，恢复时连同下面 dialogOptions / selectDialogMode / 模板那一行一起放开
// import iconDialog from "@/assets/img/icon-settings-dialog.svg";
import iconLanguage from "@/assets/img/icon-settings-language.svg";
import iconMemory from "@/assets/img/icon-settings-memory.svg";
import iconPureMode from "@/assets/img/icon-settings-pure-mode.svg";
import iconSound from "@/assets/img/icon-settings-timbre.svg";
import { toApiLanguage, useSettingsStore, useSystemStore } from "@/stores";

/**
 * 设置弹层（设计稿 54:951「设置」，375×812 画布，节点 54:952 是它的全屏遮罩）。
 *
 * 结构对应设计稿：
 * - 54:952 全屏遮罩 `#0D0D0D` 40% 不透明度；
 * - 54:955 底部面板 375×433、顶角 20px 圆角、底色 `#FAFAFA`、无投影；
 * - 180:70 卡片一 331×102：记忆 / 纯净模式（白底、圆角 16、内边距 18、行距 18）；
 * - 54:956 卡片二 331×216：外观 / 声音 / 语言（白底、圆角 12、同为 18 内边距与行距）；
 *   其中「对话」一行（180:199）暂时隐藏，见模板里的注释；
 * - 54:954 底部《个人信息清单》《三方信息共享清单》链接 14px Medium `#1166D6`（暂按要求隐藏）。
 *
 * 数据：接口文档 4.5。进应用时 `App.vue` 已用 settings store 拉过一次全量；本组件每次打开再拉一次，
 * `PUT /settings` 为部分更新（只传本次改动的字段），响应仍是全量并以此回显。
 * 语言 → 全局 i18n / header，外观 → system store，其余字段 → settings store。
 */
defineOptions({ name: "AiSettingsSheet" });

type AppLanguage = "zh_CN" | "en_US";

const props = defineProps({
  visible: { type: Boolean, default: false },
  language: { type: String as PropType<AppLanguage>, default: "zh_CN" },
  /**
   * 深色主题（首页问答态）：面板 / 卡片 / 文字 / 分段控件换深色材质。
   * 设计稿 54:951 只有浅色稿，深色沿用历史暗色梯度推：
   * 面板 #1A1A1A、卡片 #212121、分段轨道 #303030、选中项白底黑字、文案白、黑色图标反相，
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
/**
 * 数据统一放 settings store：进应用时 App.vue 已经 load 过一次，
 * 打开弹层再 load 一次拿最新值；组件只负责展示与触发，不再自己持有开关状态。
 */
const settingsStore = useSettingsStore();
// 「对话」入口暂时隐藏：dialogueMode 仍由 settings store 维护，只是这里不再展示 / 切换
const { memoryEnabled, pureMode } = storeToRefs(settingsStore);

const appearanceOptions: Array<{ value: AppearanceMode; label: string }> = [
  { value: "system", label: "settings-appearance-system" },
  { value: "light", label: "settings-appearance-light" },
  { value: "dark", label: "settings-appearance-dark" },
];

/**
 * 界面上「实时语音」= 接口 realtime，「语音输入」= 接口 push。
 * 「对话」一行暂时去掉，恢复时按这两个 i18n key（settings-dialog-realtime /
 * settings-dialog-voice-input）重建分段控件。
 */

/** 每次打开弹层再拉一次全量，回显以服务端为准（接口文档 4.5 GET /settings） */
watch(
  () => props.visible,
  (visible) => {
    if (visible) void settingsStore.load();
  },
);

function close() {
  emit("update:visible", false);
}

/** 设计稿 54:997「声音」：先收面板再跳声音设置页（Ardot 180:143），避免返回时面板还开着 */
function openSoundSettings() {
  close();
  uni.navigateTo({ url: "/pages/sound-settings/index" });
}

/** 保存失败：store 内部已回滚到上次确认值，这里只补一句提示 */
function notifyIfFailed(result: Promise<boolean>) {
  void result.then((ok) => {
    if (!ok) uni.showToast({ title: t("settings-save-failed"), icon: "none" });
  });
}

function toggleMemory() {
  notifyIfFailed(settingsStore.setMemory(!memoryEnabled.value));
}

function togglePureMode() {
  notifyIfFailed(settingsStore.setPureMode(!pureMode.value));
}

function selectAppearance(value: AppearanceMode) {
  if (systemStore.appearance === value) return;
  notifyIfFailed(settingsStore.setAppearance(value));
}

function selectLanguage(value: AppLanguage) {
  if (value === props.language) return;
  // 界面语言立刻切（父级走 systemStore.setLanguage），同时把接口口径的 zh / en 落库
  emit("update:language", value);
  notifyIfFailed(settingsStore.save({ language: toApiLanguage(value) }));
}

// 「对话」一行暂时隐藏：切回入口时恢复 selectDialogMode，
// 实现见 settingsStore.setDialogueMode(settingsStore.dialogueMode)。
</script>

<template>
  <view v-if="visible" class="settings-sheet__mask" :class="{ 'settings-sheet__mask--dark': dark }" @tap.stop="close">
    <!-- 设计稿 54:955 Rectangle 144：底部面板 375×433、顶角 20px（40rpx）、#FAFAFA、无投影 -->
    <view class="settings-sheet" @tap.stop>
      <!-- ===== 设计稿 180:70 Frame 99：卡片一 331×102，圆角 16px（32rpx），内边距 / 行距 18px（36rpx） ===== -->
      <view class="settings-sheet__card settings-sheet__card--first">
        <!-- 设计稿 180:71：记忆 + 180:79 开关（开启态） -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconMemory" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-memory") }}</text>
          <view
            class="settings-sheet__switch"
            :class="{ 'settings-sheet__switch--off': !memoryEnabled }"
            @tap.stop="toggleMemory"
          >
            <view class="settings-sheet__switch-thumb" />
          </view>
        </view>

        <!-- 设计稿 180:93：纯净模式 + 180:100 开关（接口默认 false，即关闭） -->
        <view class="settings-sheet__row">
          <image class="settings-sheet__icon" :src="iconPureMode" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-pure-mode") }}</text>
          <view
            class="settings-sheet__switch"
            :class="{ 'settings-sheet__switch--off': !pureMode }"
            @tap.stop="togglePureMode"
          >
            <view class="settings-sheet__switch-thumb" />
          </view>
        </view>
      </view>

      <!-- ===== 设计稿 54:956 Frame 98：卡片二 331×216，圆角 12px（24rpx），内边距 / 行距 18px（36rpx） ===== -->
      <view class="settings-sheet__card settings-sheet__card--second">
        <!-- 设计稿 54:981：外观 + 54:983 系统 / 浅色 / 深色分段 -->
        <view class="settings-sheet__row settings-sheet__row--segment">
          <image class="settings-sheet__icon" :src="iconAppearance" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-appearance") }}</text>
          <view class="settings-sheet__segment">
            <view
              v-for="option in appearanceOptions"
              :key="option.value"
              class="settings-sheet__segment-item"
              :class="{ 'settings-sheet__segment-item--active': systemStore.appearance === option.value }"
              @tap.stop="selectAppearance(option.value)"
            >
              {{ t(option.label) }}
            </view>
          </view>
        </view>

        <!-- 设计稿 54:997：声音 + 54:1006 展开箭头 → 跳声音设置页（Ardot 180:143） -->
        <view class="settings-sheet__row" @tap.stop="openSoundSettings">
          <image class="settings-sheet__icon" :src="iconSound" mode="aspectFit" />
          <text class="settings-sheet__label">{{ t("settings-sound") }}</text>
          <image class="settings-sheet__chevron" :src="iconChevron" mode="aspectFit" />
        </view>

        <!-- 设计稿 180:186：语言 + 180:192 中文 / EN 分段 -->
        <view class="settings-sheet__row settings-sheet__row--segment">
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

        <!-- 设计稿 180:199「对话」（实时语音 / 语音输入）一行暂时去掉：
             需要恢复时按 settings 稿重新加回这一行，取值走 settingsStore.dialogueMode，
             写回走 settingsStore.setDialogueMode，分段样式复用 .settings-sheet__segment-item--text -->
      </view>

      <!-- 设计稿 54:954：《个人信息清单》《三方信息共享清单》14px Medium #1166D6
           暂时隐藏，需要恢复时取消注释即可（样式 .settings-sheet__links 保留） -->
      <!-- <text class="settings-sheet__links">{{ t("settings-privacy-links") }}</text> -->
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 设计稿 54:952 Rectangle 4：全屏遮罩，#0D0D0D + 40% 不透明度 */
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

/* 设计稿 54:955 Rectangle 144：面板 375×433（高 866rpx 由内容撑开）、顶角 20px（40rpx）、#FAFAFA、无投影
   内边距：上 22px（44rpx，面板顶到卡片一）、左右 22px（44rpx，卡片宽 331 = 375 - 22×2）、下 31px（62rpx） */
.settings-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  padding: 44rpx 44rpx 62rpx;
  border-radius: 40rpx 40rpx 0 0;
  background: #fafafa;
}

/* 设计稿 180:70 / 54:956：两张白色卡片，内边距 18px（36rpx），行距 18px（36rpx） */
.settings-sheet__card {
  display: flex;
  flex-direction: column;
  gap: 36rpx;
  padding: 36rpx;
  background: #ffffff;
}

/* 设计稿 180:70 Frame 99：卡片一，圆角 16px（32rpx） */
.settings-sheet__card--first {
  border-radius: 32rpx;
}

/* 设计稿 54:956 Frame 98：卡片二，圆角 12px（24rpx）；与卡片一间距 22px（44rpx） */
.settings-sheet__card--second {
  margin-top: 44rpx;
  border-radius: 24rpx;
}

/* 行：图标 24px（48rpx）+ 文字 + 右侧控件，图标到文字 6px（12rpx） */
.settings-sheet__row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

/* 设计稿 54:993 / 180:188 / 180:201：带分段控件的行高 34px（68rpx），由分段控件撑开 */
.settings-sheet__row--segment {
  min-height: 68rpx;
}

/* 设计稿 180:73 / 180:96 / 54:993 / 54:998 / 180:188 / 180:201：24×24（48rpx）单色图标 */
.settings-sheet__icon {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

/* 设计稿 180:72 / 180:99 / 54:982 / 54:1005 / 180:187 / 180:200：16px（32rpx）/ Regular / #0D0D0D，行高 23px
   label 只吃剩余宽度：分段（尤其英文）撑开后不再换行，极端窄屏才省略 */
.settings-sheet__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #0d0d0d;
  font-size: 32rpx;
  font-weight: 400;
  line-height: 46rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 设计稿 180:79 / 180:100：44×22（88×44rpx）轨道，圆角 11px（22rpx），开启 #1166D6 */
.settings-sheet__switch {
  position: relative;
  flex-shrink: 0;
  width: 88rpx;
  height: 44rpx;
  border-radius: 22rpx;
  background: #1166d6;
}

/* 设计稿 180:80 / 180:102：18×18（36rpx）白色滑块，距轨道边 2px（4rpx） */
.settings-sheet__switch-thumb {
  position: absolute;
  top: 4rpx;
  right: 4rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: #ffffff;
}

/* 设计稿 180:101 Rectangle 154：关闭态轨道 #E8E8E8，滑块移到左侧 */
.settings-sheet__switch--off {
  background: #e8e8e8;
}

.settings-sheet__switch--off .settings-sheet__switch-thumb {
  right: auto;
  left: 4rpx;
}

/* 设计稿 54:983 / 180:192 / 180:205 Frame 99：轨道 #F3F3F3、圆角 10px（20rpx），
   padding 上 2 / 右 3 / 下 2 / 左 3（4/6/4/6rpx），分段间距 2px（4rpx） */
.settings-sheet__segment {
  display: flex;
  flex-shrink: 0;
  gap: 4rpx;
  padding: 4rpx 6rpx;
  border-radius: 20rpx;
  background: #f3f3f3;
}

/* 设计稿 54:990 等：分段 46×30（92×60rpx）、圆角 10px（20rpx）；
   未选中 #F3F3F3 底 + #5D5D5D 文字，选中白底 + #0D0D0D 文字。
   宽度按 92rpx 起算（中文两字 30px + 左右各 8px），英文文案更长时由内容撑开 */
.settings-sheet__segment-item {
  display: flex;
  box-sizing: border-box;
  min-width: 92rpx;
  height: 60rpx;
  align-items: center;
  justify-content: center;
  padding: 0 16rpx;
  border-radius: 20rpx;
  background: #f3f3f3;
  color: #5d5d5d;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 44rpx;
  white-space: nowrap;
}

/* 设计稿 180:206 Frame 130：文字型分段（实时语音 / 语音输入），宽度随文案、内边距 3/8（6/16rpx） */
.settings-sheet__segment-item--text {
  min-width: 0;
  padding: 0 16rpx;
}

/* 选中：白底 + #0D0D0D 文字 */
.settings-sheet__segment-item--active {
  background: #ffffff;
  color: #0d0d0d;
}

/* 设计稿 54:1006 Collapse：24×24（48rpx）箭头，描边 #0D0D0D */
.settings-sheet__chevron {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

/* 设计稿 54:954：14px（28rpx）/ Medium(500) / #1166D6，行高 20px（40rpx），
   与卡片二间距 20px（40rpx），左对齐 */
.settings-sheet__links {
  margin-top: 40rpx;
  color: #1166d6;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
}

/* ===== 深色主题：设置弹层（首页问答态）=====
   设计稿 54:951 只有浅色稿，深色沿用历史抽屉的同一套材质推，
   尺寸 / 间距 / 圆角 / 动效不动：
   - 面板 54:955：#FAFAFA → #1A1A1A；卡片 180:70 / 54:956：#FFFFFF → #212121（比面板亮一阶）
   - 遮罩 54:952：rgba(13,13,13,0.4)，两稿同值，不改
   - 文案 180:72 等：#0D0D0D → #FFFFFF；黑色图标反相为白
   - 分段 54:983 / 180:192 / 180:205：轨道 #F3F3F3 → #303030，
     未选中文字 #8F8F8F，选中项黑白反转（#FFFFFF 底 + #0D0D0D 字）
   - 开关 180:79：开启仍是品牌蓝 #1166D6，关闭态 #E8E8E8 → #303030
   - 底部链接 54:954：保留品牌蓝 #1166D6（设计稿未给深色值，不臆造） */
.settings-sheet__mask--dark {
  .settings-sheet {
    background: #1a1a1a;
  }

  .settings-sheet__card {
    background: #212121;
  }

  .settings-sheet__label {
    color: #ffffff;
  }

  // 记忆 / 纯净模式 / 外观 / 声音 / 语言 / 对话 / 箭头都是纯黑矢量，深底下反相成白
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
