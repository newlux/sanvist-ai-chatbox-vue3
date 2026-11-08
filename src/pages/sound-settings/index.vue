<script setup lang="ts">
import type { ListenBroadcastVoice } from "@/api/listen-broadcast/types";
import type { ReportVoiceOption } from "@/config/report-voices";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getListenBroadcastConfig } from "@/api/listen-broadcast";
import backIcon from "@/assets/img/icon-sound-settings-back.svg";
import waveActiveIcon from "@/assets/img/icon-sound-settings-wave-active.svg";
import waveIcon from "@/assets/img/icon-sound-settings-wave.svg";
import { REPORT_VOICE_OPTIONS } from "@/config/report-voices";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSettingsStore } from "@/stores";
import { createLogger } from "@/utils/logger";

/**
 * 声音设置页（Ardot 180:143「声音设置」，375×831）。
 *
 * 结构对应设计稿：
 * - 180:144 Status Bar：真实设备由系统状态栏承担，这里只按安全区留出高度；
 * - 180:160 Top Nav 375×50：返回箭头 24×24 + 标题 18px 居中；
 * - 180:177 播放速度卡 331×91：标题 12px + 右侧当前倍率 12px，轨道 299×4 + 已播进度 + 10px 滑块，
 *   刻度 1.0x / 2.0x（区间按设置里的语音倍率固定 1.0–2.0，五档吸附：
 *   1.0 / 1.2 / 1.5 / 1.8 / 2.0，不允许拖出区间，也不允许出现 1.1 这类中间值）；
 * - 180:246 声音列表面板 330×586：白底、内边距 16，内含 8 张 298×64 音色卡（gap 6），
 *   选中卡 1px `#1166D6` 描边 + 「默认」徽标，右侧 18×18 波形图标。
 *
 * 卡片文案（对齐设计稿 180:211 / 180:212）：
 * - 主标题 = 音色「类型」，如「温柔知性」（取接口 description，缺失回退本地 tagKey）；
 * - 灰色说明 = 该类型的描述句，如「温柔亲和，陪伴式对话自然舒适」（本地 i18n slogan）。
 *
 * 数据：接口文档 4.5 `/settings`，`voiceCode` 是全局音色、`speechRate` 是语速倍率；
 * 每次操作只 PUT 本次改动的字段。音色列表取 `/listen-broadcast/config` 的 `voices`，
 * 接口没给时退回本地 `REPORT_VOICE_OPTIONS`（与听播音色同一份配置）。
 *
 * 交互：
 * - 点整张音色卡 = 选中并立即落库；点右侧波形图标 = 试听（本地 wav），
 *   播放中图标换成蓝色音波条并做呼吸动效，再点一次停止；
 * - 倍率每次切档（松手 / 点击档位）立即落库，不做节流；
 * - 落库成功「保存成功」、失败「保存失败，请稍后重试」，统一用页面正中的白底蓝边胶囊提示。
 */
const logger = createLogger("sound-settings");

const { t, te } = useI18n();
const { safeAreaStyle } = useSafeArea();
const settingsStore = useSettingsStore();

/**
 * 语速档位：只允许 1.0 / 1.2 / 1.5 / 1.8 / 2.0 五档（与设置里「语音倍率」面板一致），
 * 滑杆区间固定 1.0x–2.0x，不能拖出区间，也不能出现 1.1 这种非档位值。
 */
const RATE_OPTIONS = [1, 1.2, 1.5, 1.8, 2] as const;
const RATE_MIN = RATE_OPTIONS[0];
const RATE_MAX = RATE_OPTIONS[RATE_OPTIONS.length - 1];
/** 默认倍率 1.2：与听播页默认倍速一致（见 config/report-playback-rate） */
const DEFAULT_RATE = 1.2;

interface SoundVoice {
  code: string;
  /** 类型（主标题），如「温柔知性」 */
  type: string;
  /** 灰色说明句，如「温柔亲和，陪伴式对话自然舒适」 */
  slogan: string;
  /** 试听音频（本地 wav），接口新增的音色可能没有 */
  preview: string;
}

const voices = ref<SoundVoice[]>([]);
/** 滑杆拖动期间的本地值，松手才落库；首屏优先承接 store 里已有的服务端值，避免闪一下默认值 */
const rate = ref(normalizeRate(settingsStore.speechRate));
const dragging = ref(false);
/** 正在试听的音色 code（空串 = 没在播） */
const playingCode = ref("");
/** 保存结果提示文案（空串 = 不显示），白底蓝边胶囊，页面正中 */
const toastText = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(text: string) {
  toastText.value = text;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastText.value = "";
    toastTimer = null;
  }, 1500);
}

/** 系统默认音色 = 列表第一项（服务端「空串」语义） */
const defaultVoiceCode = computed(() => voices.value[0]?.code || "");
/**
 * 选中态以本地为准：`/settings` 不回 voiceCode，直接拿 store 当唯一来源会导致
 * 点任何卡片后选中框都跳回第一项。所以点卡片先乐观选中，回包给非空 voiceCode 再以它为准。
 */
const pickedVoiceCode = ref(settingsStore.voiceCode);
const selectedVoiceCode = computed(() => {
  const picked = pickedVoiceCode.value;
  if (picked && voices.value.some(item => item.code === picked)) return picked;
  return defaultVoiceCode.value;
});
/** 当前值落在第几档（五档等分轨道，0 = 1.0x，4 = 2.0x） */
const rateIndex = computed(() => nearestRateIndex(rate.value));
/** 轨道中间三档的刻度点（1.2 / 1.5 / 1.8），两端由刻度文字表示 */
const rateDots = computed(() => RATE_OPTIONS.slice(1, -1));
const rateRatio = computed(() => rateIndex.value / (RATE_OPTIONS.length - 1));
/** 设计稿 180:183 文案「1.20x（默认）」：等于默认倍率时补后缀，浮点按误差判定 */
const isDefaultRate = computed(() => Math.abs(rate.value - DEFAULT_RATE) < 0.001);
const rateText = computed(() => {
  const text = formatRate(rate.value);
  return isDefaultRate.value ? `${text}${t("sound-settings-rate-default-suffix")}` : text;
});

/** 档位都只有一位小数，写法与设置里的语音倍率面板一致：1.0x / 1.2x / 1.5x / 1.8x / 2.0x */
function formatRate(value: number) {
  return `${value.toFixed(1)}x`;
}

/** 取离给定值最近的档位下标（服务端可能给出 1.1 / 2.5 这类非档位值） */
function nearestRateIndex(value: number) {
  return RATE_OPTIONS.reduce(
    (best, option, index) => (Math.abs(option - value) < Math.abs(RATE_OPTIONS[best] - value) ? index : best),
    0,
  );
}

/** 倍率兜底：任何非档位 / 越界值（含 NaN / 未拉到）都吸附到最近档位，1.2 是默认档 */
function normalizeRate(value: unknown) {
  const next = Number(value);
  if (!Number.isFinite(next)) return DEFAULT_RATE;
  return RATE_OPTIONS[nearestRateIndex(next)];
}

/** 按 code 找本地音色配置（code 形如 `xieshurou_v3.1`） */
function localOption(code: string) {
  return REPORT_VOICE_OPTIONS.find(item => item.id === code);
}

/**
 * 灰色说明句：i18n key 用 code 前缀（`report-voice-slogan-xieshurou`），
 * 版本号变了也能命中；没有对应文案时退回「适合日常汇报」这类短说明。
 */
function sloganOf(code: string, option?: ReportVoiceOption) {
  const prefix = code.split("_")[0];
  const key = `report-voice-slogan-${prefix}`;
  if (prefix && te(key)) return t(key);
  return option ? t(option.descriptionKey) : "";
}

/** 本地音色配置转成同一结构：类型走 tagKey、说明走 slogan（与听播音色同一份文案） */
function fallbackVoices(): SoundVoice[] {
  return REPORT_VOICE_OPTIONS.map(option => ({
    code: option.id,
    type: t(option.tagKey),
    slogan: sloganOf(option.id, option),
    preview: option.preview,
  }));
}

function toVoices(list?: ListenBroadcastVoice[]): SoundVoice[] {
  const fromApi = (list || [])
    .map((item) => {
      const code = String(item?.code || "");
      if (!code) return null;
      const option = localOption(code);
      // 主标题只放「类型」：接口 description 就是类型；没有再退回本地 tagKey，绝不用人名
      const type = String(item?.description || "").trim() || (option ? t(option.tagKey) : code);
      return {
        code,
        type,
        slogan: sloganOf(code, option),
        preview: option?.preview || "",
      } satisfies SoundVoice;
    })
    .filter((item): item is SoundVoice => Boolean(item));
  return fromApi.length ? fromApi : fallbackVoices();
}

async function loadVoices() {
  try {
    const config = await getListenBroadcastConfig();
    voices.value = toVoices(config?.voices);
  }
  catch (error) {
    logger.warn("load voice list failed, fallback to local config", error);
    voices.value = fallbackVoices();
  }
}

/** 保存结果统一提示：成功「保存成功」，失败「保存失败，请稍后重试」 */
function notifySaveResult(result: Promise<boolean>) {
  void result.then((ok) => {
    showToast(ok ? t("save-success") : t("settings-save-failed"));
  });
}

// —— 试听：音频取本地 wav（见 report-voices），同一时刻只播一个 ——
let previewAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

function stopPreview() {
  playingCode.value = "";
  previewAudio?.stop();
}

/** 复用同一个播放器：播完 / 出错自动回收播放态，主动 stop 交给 stopPreview */
function ensurePreviewAudio() {
  if (previewAudio) return previewAudio;
  const audio = uni.createInnerAudioContext();
  audio.onEnded(() => {
    playingCode.value = "";
  });
  audio.onError((error) => {
    logger.warn("voice preview play failed", error);
    playingCode.value = "";
  });
  previewAudio = audio;
  return audio;
}

/** 播某个音色的试听；接口新增、本地没有 wav 的音色直接跳过 */
function playPreview(voice: SoundVoice) {
  if (!voice.preview) {
    logger.warn("该音色没有本地试听音频", voice.code);
    return;
  }
  const audio = ensurePreviewAudio();
  audio.stop();
  audio.src = voice.preview;
  playingCode.value = voice.code;
  audio.play();
}

/**
 * 点整张卡：选中 + 立刻试听它的音色（点已选中的卡只重播，不重复落库）。
 * 选中框先跟上点击，保存失败再回滚。
 */
function selectVoice(voice: SoundVoice) {
  if (voice.code !== selectedVoiceCode.value) {
    const previous = pickedVoiceCode.value;
    pickedVoiceCode.value = voice.code;
    void settingsStore.save({ voiceCode: voice.code }).then((ok) => {
      if (!ok) pickedVoiceCode.value = previous;
      showToast(ok ? t("save-success") : t("settings-save-failed"));
    });
  }
  playPreview(voice);
}

/** 点波形图标：同一个音色再点一次即停止，换音色则切播 */
function togglePreview(voice: SoundVoice) {
  if (voice.code === playingCode.value) {
    stopPreview();
    return;
  }
  playPreview(voice);
}

onUnmounted(() => {
  previewAudio?.stop();
  previewAudio?.destroy();
  previewAudio = null;
  playingCode.value = "";
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
});

// —— 滑杆：设计稿轨道 299×4，滑块 10px；用触摸位置换算比例，松手落库 ——
let trackLeft = 0;
let trackWidth = 0;

/** 量一次轨道位置与宽度；首帧布局 / 安全区变化后位置会变，触摸开始时重测 */
function measureTrack(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.createSelectorQuery()
      .select(".sound-settings__slider-track")
      .boundingClientRect((rect) => {
        const info = (Array.isArray(rect) ? rect[0] : rect) as UniApp.NodeInfo | null;
        if (!info || !info.width) {
          resolve(false);
          return;
        }
        trackLeft = info.left;
        trackWidth = info.width;
        resolve(true);
      })
      .exec();
  });
}

/** 触摸位置 → 档位：轨道五等分，吸附到最近一档，拖到区间外也只会停在 1.0x / 2.0x */
function updateFromClientX(clientX: number) {
  if (trackWidth <= 0) return;
  const ratio = Math.min(1, Math.max(0, (clientX - trackLeft) / trackWidth));
  const index = Math.round(ratio * (RATE_OPTIONS.length - 1));
  rate.value = RATE_OPTIONS[Math.min(RATE_OPTIONS.length - 1, Math.max(0, index))];
}

/**
 * 桌面浏览器没有 touch 事件，补一个 tap 兜底：
 * uni 的 tap 事件 detail 在 H5 下是对象（含 x），原生 MouseEvent 下是数字，真正的坐标取 clientX。
 */
function onSliderTap(event: { detail?: number | { x?: number }; clientX?: number }) {
  // 动倍率属于「其他操作」，先掐掉正在播的试听
  stopPreview();
  const detailX = typeof event?.detail === "object" ? event.detail?.x : undefined;
  const x = Number(detailX ?? event?.clientX);
  void measureTrack().then((ok) => {
    if (!ok || !Number.isFinite(x)) return;
    updateFromClientX(x);
    // 点击直接切到某一档，同样立即落库（切换即调接口）
    commitRate();
  });
}

/** 浏览器原生 TouchEvent.touches 是 TouchList（不是数组），这里用 ArrayLike 兼容 */
interface SliderTouchEvent {
  touches?: ArrayLike<{ clientX?: number }>;
}

function onSliderTouchStart(event: SliderTouchEvent) {
  // 手指一碰滑杆就停试听，避免和正在播的音色混在一起
  stopPreview();
  dragging.value = true;
  const clientX = Number(event?.touches?.[0]?.clientX);
  void measureTrack().then((ok) => {
    if (ok && Number.isFinite(clientX)) updateFromClientX(clientX);
  });
}

function onSliderTouchMove(event: SliderTouchEvent) {
  if (!dragging.value) return;
  const clientX = Number(event?.touches?.[0]?.clientX);
  if (Number.isFinite(clientX)) updateFromClientX(clientX);
}

function onSliderTouchEnd() {
  if (!dragging.value) return;
  dragging.value = false;
  commitRate();
}

function commitRate() {
  // 只会是五档之一，直接提交档位值
  const value = rate.value;
  // 与服务端值一致就不用发请求（浮点按误差判定）
  if (Math.abs(value - settingsStore.speechRate) < 0.001) return;
  notifySaveResult(settingsStore.save({ speechRate: value }));
}

// 服务端回包给非空 voiceCode 时以它为准（接口以后补上这个字段会自动生效）
watch(
  () => settingsStore.voiceCode,
  (value) => {
    if (value) pickedVoiceCode.value = value;
  },
);

// 响应回来（可能被服务端收敛）后以服务端值为准回显；拖动中不打断
watch(
  () => settingsStore.speechRate,
  (value) => {
    if (!dragging.value) rate.value = normalizeRate(value);
  },
);

function goBack() {
  // 离开页面立即停试听（onUnmounted 也会兜底）
  stopPreview();
  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  uni.reLaunch({ url: "/pages/index/index" });
}

onMounted(async () => {
  void measureTrack();
  // 进页面拉一次 /settings：voiceCode / speechRate 以服务端为准；没拉到就落在默认 1.2
  const [settings] = await Promise.all([settingsStore.load(), loadVoices()]);
  if (!dragging.value) rate.value = normalizeRate(settings?.speechRate);
});
</script>

<template>
  <view class="sound-settings" :style="safeAreaStyle">
    <!-- 设计稿 180:144 Status Bar：真机由系统状态栏显示，这里只占安全区高度 -->
    <view class="sound-settings__status" />

    <!-- 设计稿 180:160 Top Nav：375×50，左右 20、上下 4；返回 24×24 + 标题 18px 居中 -->
    <view class="sound-settings__nav">
      <view class="sound-settings__back" @tap="goBack">
        <image class="sound-settings__back-icon" :src="backIcon" mode="aspectFit" />
      </view>
      <text class="sound-settings__title">{{ t("sound-settings-title") }}</text>
      <!-- 设计稿 180:164 右侧 24×24 帧内子节点全部不可见：留同宽占位保证标题居中 -->
      <view class="sound-settings__nav-placeholder" />
    </view>

    <scroll-view class="sound-settings__body" scroll-y>
      <view class="sound-settings__content">
        <!-- 设计稿 180:177 Group 179：播放速度卡 331×91，白底、圆角 12、内边距 16 -->
        <view class="sound-settings__speed">
          <!-- 180:184 播放速度 12px #0D0D0D / 180:183 当前倍率 12px #5D5D5D 右对齐 -->
          <view class="sound-settings__speed-head">
            <text class="sound-settings__speed-label">{{ t("sound-settings-speed") }}</text>
            <text class="sound-settings__speed-value">{{ rateText }}</text>
          </view>

          <!-- 180:180 轨道 299×4 / 180:181 已播进度 / 180:182 滑块 10px（白底 + 2px #1166D6 描边） -->
          <view
            class="sound-settings__slider"
            @tap="onSliderTap"
            @touchstart.stop="onSliderTouchStart"
            @touchmove.stop.prevent="onSliderTouchMove"
            @touchend.stop="onSliderTouchEnd"
            @touchcancel.stop="onSliderTouchEnd"
          >
            <view class="sound-settings__slider-track">
              <view class="sound-settings__slider-progress" :style="{ width: `${rateRatio * 100}%` }" />
              <!-- 中间三档刻度点（1.2x / 1.5x / 1.8x），两端由下方 1.0x / 2.0x 文字表示，共 5 档 -->
              <view
                v-for="(option, index) in rateDots"
                :key="option"
                class="sound-settings__slider-dot"
                :class="{ 'sound-settings__slider-dot--active': index + 1 <= rateIndex }"
                :style="{ left: `${((index + 1) / (RATE_OPTIONS.length - 1)) * 100}%` }"
              />
              <view class="sound-settings__slider-thumb" :style="{ left: `${rateRatio * 100}%` }" />
            </view>
          </view>

          <!-- 180:179 / 180:185 刻度：12px #8E8E8E，左右贴轨道两端；
               区间按设置里的语音倍率固定 1.0x–2.0x（五档等分，见 RATE_OPTIONS） -->
          <view class="sound-settings__ticks">
            <text class="sound-settings__tick">{{ formatRate(RATE_MIN) }}</text>
            <text class="sound-settings__tick">{{ formatRate(RATE_MAX) }}</text>
          </view>
        </view>

        <!-- 设计稿 180:246 Frame 135：声音列表面板 330×586，白底、内边距 16、卡片间距 6 -->
        <view class="sound-settings__list">
          <view
            v-for="voice in voices"
            :key="voice.code"
            class="sound-settings__voice"
            :class="{ 'sound-settings__voice--active': voice.code === selectedVoiceCode }"
            @tap="selectVoice(voice)"
          >
            <view class="sound-settings__voice-main">
              <!-- 180:211 类型 14px Medium #000000 + 180:220「默认」徽标（仅默认音色） -->
              <view class="sound-settings__voice-title-row">
                <text class="sound-settings__voice-name">{{ voice.type }}</text>
                <text v-if="voice.code === defaultVoiceCode" class="sound-settings__voice-badge">
                  {{ t("sound-settings-default") }}
                </text>
              </view>
              <!-- 180:212 说明 12px #8E8E8E -->
              <text v-if="voice.slogan" class="sound-settings__voice-desc">{{ voice.slogan }}</text>
            </view>
            <!-- 198:168 Frame 117：18×18 波形图标，点击试听（播放中换蓝色并做呼吸动效） -->
            <view class="sound-settings__voice-play" @tap.stop="togglePreview(voice)">
              <image
                class="sound-settings__voice-icon"
                :class="{ 'sound-settings__voice-icon--playing': playingCode === voice.code }"
                :src="playingCode === voice.code ? waveActiveIcon : waveIcon"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 保存结果提示：白底 + 1px #1166D6 描边 + 圆角胶囊，页面正中（对齐设计截图） -->
    <view v-if="toastText" class="sound-settings__toast">
      {{ toastText }}
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 设计稿 180:143 页面：375×831，底色 #FAFAFA */
.sound-settings {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #fafafa;
}

/* 保存结果提示：白底 + 1px（2rpx）#1166D6 描边 + 胶囊圆角，文字 15px（30rpx）#0D0D0D，
   固定页面正中；pointer-events 关掉，不挡下面卡片的点击 */
.sound-settings__toast {
  position: fixed;
  z-index: 1200;
  bottom: 20%;
  left: 50%;
  box-sizing: border-box;
  min-width: 200rpx;
  padding: 16rpx 36rpx;
  border: 2rpx solid #1166d6;
  border-radius: 40rpx;
  background: #ffffff;
  color: #0d0d0d;
  font-size: 30rpx;
  line-height: 42rpx;
  text-align: center;
  pointer-events: none;
  transform: translateX(-50%);
}

.sound-settings__status {
  flex: 0 0 var(--safe-top-px, 0px);
}

/* 设计稿 180:160 Top Nav：高 50px（100rpx），左右 20px（40rpx），上下 4px（8rpx） */
.sound-settings__nav {
  display: flex;
  box-sizing: border-box;
  flex: 0 0 100rpx;
  align-items: center;
  padding: 8rpx 40rpx;
}

.sound-settings__back {
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
}

.sound-settings__back-icon {
  width: 48rpx;
  height: 48rpx;
}

/* 设计稿 180:163 标题：18px（36rpx）/ Regular / #0D0D0D / 居中 */
.sound-settings__title {
  flex: 1;
  color: #0d0d0d;
  font-size: 36rpx;
  font-weight: 400;
  line-height: 52rpx;
  text-align: center;
}

.sound-settings__nav-placeholder {
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
}

.sound-settings__body {
  flex: 1;
  min-height: 0;
}

/* 设计稿：导航底 98 → 卡片顶 117 相距 19px（38rpx）；卡片左右各 22px（44rpx）；底部 25px（50rpx） */
.sound-settings__content {
  display: flex;
  flex-direction: column;
  padding: 38rpx 44rpx 50rpx;
}

/* 设计稿 180:178：白底、圆角 12px（24rpx）、内边距 16px（32rpx） */
.sound-settings__speed {
  display: flex;
  flex-direction: column;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

.sound-settings__speed-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

/* 180:184 / 180:183：12px（24rpx）、行高 17px（34rpx） */
.sound-settings__speed-label {
  color: #0d0d0d;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
}

.sound-settings__speed-value {
  color: #5d5d5d;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  text-align: right;
}

/* 滑块实际高度 10px（20rpx），轨道 4px 居中：标题底 33 → 轨道顶 46，即容器顶 43（相距 10px / 20rpx） */
.sound-settings__slider {
  position: relative;
  display: flex;
  align-items: center;
  height: 20rpx;
  margin-top: 20rpx;
}

/* 180:180：轨道 299×4（598×8rpx）、圆角 4px（8rpx）、#F3F3F3 */
.sound-settings__slider-track {
  position: relative;
  width: 100%;
  height: 8rpx;
  border-radius: 8rpx;
  background: #f3f3f3;
}

/* 180:181：已播进度 #1166D6、圆角 4px；五档吸附，加一点过渡让跳档不突兀 */
.sound-settings__slider-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 8rpx;
  border-radius: 8rpx;
  background: #1166d6;
  transition: width 120ms ease-out;
}

/* 五档刻度点：中间三档（1.2 / 1.5 / 1.8）画 4px（8rpx）圆点，
   未选中在灰轨道上是 #D6D6D6，被蓝色进度覆盖后翻白，一眼能看出只有 5 档 */
.sound-settings__slider-dot {
  position: absolute;
  top: 50%;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #d6d6d6;
  transform: translate(-50%, -50%);
  transition: background-color 120ms ease-out;
}

.sound-settings__slider-dot--active {
  background: #ffffff;
}

/* 180:182：滑块 10×10（20×20rpx），白底 + 2px（4rpx）#1166D6 描边 */
.sound-settings__slider-thumb {
  position: absolute;
  top: 50%;
  width: 20rpx;
  height: 20rpx;
  box-sizing: border-box;
  border: 4rpx solid #1166d6;
  border-radius: 50%;
  background: #ffffff;
  transform: translate(-50%, -50%);
  transition: left 120ms ease-out;
}

/* 180:179 / 180:185：刻度 12px（24rpx）#8E8E8E，滑块容器底 53 → 刻度顶 58（相距 5px / 10rpx） */
.sound-settings__ticks {
  display: flex;
  justify-content: space-between;
  margin-top: 10rpx;
}

.sound-settings__tick {
  width: 60rpx;
  color: #8e8e8e;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  text-align: center;
}

/* 设计稿 180:246：面板 330×586，白底、无圆角、内边距 16px（32rpx）；与上方卡片相距 12px（24rpx） */
.sound-settings__list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 24rpx;
  padding: 32rpx;
  background: #ffffff;
}

/* 设计稿 180:219 等：卡片 298×64（596×128rpx）、白底、圆角 12px（24rpx）；
   描边常驻 1px（2rpx）透明，选中时换成 #1166D6，避免选中态导致内容位移 */
.sound-settings__voice {
  display: flex;
  box-sizing: border-box;
  height: 128rpx;
  align-items: center;
  padding: 0 42rpx 0 26rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  background: #ffffff;
  transition: border-color 150ms ease;
}

.sound-settings__voice--active {
  border-color: #1166d6;
}

.sound-settings__voice-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.sound-settings__voice-title-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

/* 180:211：14px（28rpx）/ Medium / #000000 / 行高 20px（40rpx） */
.sound-settings__voice-name {
  color: #000000;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  white-space: nowrap;
}

/* 180:220 Frame 18：30×16（60×32rpx）、底 #1166D6 10%、圆角 5px（10rpx）、左右内边距 5px（10rpx） */
.sound-settings__voice-badge {
  display: flex;
  height: 32rpx;
  align-items: center;
  padding: 0 10rpx;
  border-radius: 10rpx;
  background: rgba(17, 102, 214, 0.1);
  color: #1166d6;
  font-size: 20rpx;
  font-weight: 400;
  line-height: 28rpx;
}

/* 180:212：12px（24rpx）/ #8E8E8E / 行高 17px（34rpx）；
   设计稿标题与说明文字框有 1px 重叠（标题 14~34、说明 33~50），这里如实复现 */
.sound-settings__voice-desc {
  margin-top: -2rpx;
  overflow: hidden;
  color: #8e8e8e;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 198:168：波形图标本体 18×18（36×36rpx），右侧距卡片 22px 由卡片 padding-right 承担；
   外面包一层可点热区，::after 再向外扩 20rpx 提升点击手感（不影响布局） */
.sound-settings__voice-play {
  position: relative;
  display: flex;
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 36rpx;
  align-items: center;
  justify-content: center;
  margin-left: 14rpx;
}

.sound-settings__voice-play::after {
  position: absolute;
  top: -20rpx;
  right: -20rpx;
  bottom: -20rpx;
  left: -20rpx;
  content: "";
}

.sound-settings__voice-icon {
  width: 36rpx;
  height: 36rpx;
}

/* 播放中：图标换成 #1166D6 版本并做呼吸动效，提示「正在试听」 */
.sound-settings__voice-icon--playing {
  animation: sound-settings-wave 0.9s ease-in-out infinite;
}

@keyframes sound-settings-wave {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.45;
    transform: scale(0.86);
  }
}
</style>
