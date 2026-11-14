<script setup lang="ts">
import type { PropType } from "vue";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import heySaniDark from "@/assets/img/hey-sani-dark.svg";
import heySaniLight from "@/assets/img/hey-sani-light.svg";
import keyboardIcon from "@/assets/img/icon-keyboard-dark.svg";
import microphoneIcon from "@/assets/img/icon-mic-red.svg";
import sendUpIcon from "@/assets/img/icon-send-up.svg";
import voiceWaveActive from "@/assets/img/icon-voice-wave-blue.svg";
import voiceWaveDark from "@/assets/img/icon-voice-wave-dark.svg";
import voiceWaveLight from "@/assets/img/icon-waveform.svg";
import listenLogo from "@/assets/img/listen.gif";
// 中心 SANI 图标：先静态图打底，动图加载完成后再无缝切过去（避免 1MB 的 webp 慢网下先空白）
import saniLogoStatic from "@/assets/img/header-island-logo.png";
import saniLogoWebp from "@/assets/img/sani-logo.webp";
import { useSafeArea } from "@/hooks/useSafeArea";
import { showAttachmentComingSoon } from "@/utils/attachment-notice";
import { resolveMotionElement } from "@/utils/voice-message-motion";

/**
 * 初始页（首页 welcome 态）：中间 SANI 图标 +「Hey,SANI」，底部一条静态输入栏。
 *
 * 原来的游客 / 会员两套欢迎页（渐变标语、三行说明、底部光效、身份选择气泡等）
 * 全部停用；组件文件 visitor.vue、member.vue 仍保留在同一目录，需要恢复时换回引用即可。
 *
 * 点「点击说话」只抛 start-chat，飞出动画由父页面驱动：父页面把 logo 的目标位移
 * 算好塞进 logoStyle，本组件只负责把 transition 跑完。
 *
 * 点键盘有两条路径：
 * - 默认：抛 start-text，由父页面（guide / task）把常态 logo 送上去再聚焦输入框；
 * - `inline-input`（首页初始页）：原地把「点击说话」换成文本输入框、不跳页面，
 *   用户填完点发送才抛 send-text，父页面据此发起提问并进入对话页。
 *
 * 语音 / 文字两条起飞路径的区别只在 logo 的状态图：语音会先挂上 listen 动图
 * （从第 0 帧起播，父页面据此对齐扩散峰值），文字不换图，直接让常态图飞上去。
 *
 * `nav` 具名插槽：底部输入条上方的一行（首页在纯净模式关闭时塞快捷入口胶囊），
 * 不传就不占位；起飞时与标题 / 输入条一起淡出。
 */
defineOptions({ name: "AiWelcome" });

const props = defineProps({
  duplexEnabled: { type: Boolean, default: false },
  duplexActive: { type: Boolean, default: false },
  duplexStarting: { type: Boolean, default: false },
  /** 起飞态：底色让位给下面的对话页，标题 / 输入条淡出，logo 按 logoStyle 滑向顶部 */
  leaving: { type: Boolean, default: false },
  /** 已到顶：logo 淡出，由对话页自己的灵动岛图标接上，避免最后 1-2px 的跳变被看见 */
  landed: { type: Boolean, default: false },
  /** logo 的目标 transform（由父页面按灵动岛实际坐标算出） */
  logoStyle: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
  /**
   * 深色模式：由页面传 systemStore.isDark（宿主 getColorScheme 决定）。
   * 初始页原来只有浅色一套样式，深色宿主下会闪出一整屏 #FAFAFA，
   * 与对话页的 #1A1A1A 之间有一刀切的白块。
   */
  dark: { type: Boolean, default: false },
  /**
   * 键盘入口原地展开文本输入框（首页初始页）：
   * 点键盘不跳页，输入完点右侧发送才抛 send-text，由父页面决定何时进对话页。
   * 不传时保持旧行为 —— 抛 start-text 交给父页面的起飞动画。
   */
  inlineInput: { type: Boolean, default: false },
  /** 键盘高度（CSS px）：文本态把输入条顶到键盘上方，与对话页同一套口径 */
  keyboardHeight: { type: Number, default: 0 },
});

const emit = defineEmits<{
  (e: "start-chat", mode?: "hold", target?: EventTarget): void;
  (e: "start-text"): void;
  (e: "duplex-toggle"): void;
  (e: "send-text", text: string): void;
}>();

const { t } = useI18n();
const { safeAreaStyle } = useSafeArea();

/**
 * 「Hey,SANI」整行字标：直接用设计导出的整行图，不再用文字 + background-clip 拼。
 * - 浅色：hey-sani-light.svg（106×35，渐变字）
 * - 深色：hey-sani-dark.svg（102.69×29，白色字标）
 */
const titleImage = computed(() => (props.dark ? heySaniDark : heySaniLight));

/**
 * 声波图标：**未触发**（没开实时语音）时直接落在灰胶囊上，用深色 6 段声波；
 * **触发后**换成蓝色声波 + 白色胶囊（截图两态）。
 * 深色主题下深色图标等于看不见，这里直接换一张白色声波（同一套 6 段几何）。
 */
const waveIconIdle = computed(() => (props.dark ? voiceWaveLight : voiceWaveDark));

/**
 * 中心图标「静态图 → 动图」的无感知切换。
 *
 * sani-logo.webp 约 1MB，直接当 src 时慢网下仍会先空一块再突然出现。
 * 这里两层叠在同一个 220×220 盒子里：
 * - 底层永远是 header-island-logo.png（静态图，几百 KB，先渲染）；
 * - 动图层一开始 opacity:0（但已在下载），@load 到达后淡入、静态层同时淡出，
 *   用户看到的只是图标从静止变动态，没有空白、没有跳变。
 *
 * 模块级缓存：组件会随首页 welcome / 对话页来回切反复挂载，已经加载过一次就
 * 直接用动图，不必每次都重播一遍切换。
 */
let saniLogoLoadedOnce = false;
const saniLogoReady = ref(saniLogoLoadedOnce);

function onSaniLogoLoad() {
  if (saniLogoReady.value) return;
  saniLogoLoadedOnce = true;
  saniLogoReady.value = true;
}

/**
 * listen.gif 平时不挂载，等父页面确认「要起飞了」再创建这张图。
 *
 * 动图只要挂在页面上就在自己循环，挂载那一刻播到第几帧完全不可控，
 * 父页面就没法把「扩散到最大」对齐成固定时刻。改成起飞前才新建 <img>，
 * 浏览器一定从第 0 帧开始播，于是「480ms 后扩散到最大」才是准的。
 */
const listenMounted = ref(false);
/** 起飞中（点击说话 + listen.gif 已挂载）：两种 SANI 图都要让位给 listen.gif */
const logoDeparting = computed(() => props.leaving && listenMounted.value);
/** 兜底时长：个别容器命中缓存不派发 load，不能让页面卡在欢迎页 */
const LISTEN_READY_TIMEOUT_MS = 120;

let startFired = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

function fireStart(mode?: "hold", target?: EventTarget) {
  if (startFired) return;
  startFired = true;
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  emit("start-chat", mode, target);
}

function onListenLoad() {
  if (listenMounted.value) fireStart();
}

/**
 * 起飞：挂上 listen.gif 从第 0 帧起播，首帧就绪再抛 start-chat ——
 * 父页面据此把起飞时刻对齐「扩散到最大」。点「点击说话」直接走这里。
 */
function beginDepart() {
  if (startFired) return;
  listenMounted.value = true;
  readyTimer = setTimeout(fireStart, LISTEN_READY_TIMEOUT_MS);
}

function onSpeakTap() {
  if (props.leaving || startFired) return;
  beginDepart();
}

const speakButtonRef = ref<unknown>(null);
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdOrigin: { x: number; y: number } | null = null;
function clearSpeakHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
  holdOrigin = null;
}
function readSpeakPoint(event: unknown) {
  const source = event as TouchEvent & MouseEvent;
  const point = source.touches?.[0] || source;
  return { x: point.clientX, y: point.clientY };
}
function onSpeakPressStart(event: unknown) {
  if (props.leaving || startFired) return;
  clearSpeakHold();
  holdOrigin = readSpeakPoint(event);
  const source = event as { currentTarget?: EventTarget; target?: EventTarget };
  const target = resolveMotionElement(speakButtonRef.value)
    || (typeof source.currentTarget?.addEventListener === "function" ? source.currentTarget : source.target);
  holdTimer = setTimeout(() => {
    clearSpeakHold();
    listenMounted.value = true;
    // 长按不等 GIF 加载：先交给页面接管松手，避免等待首帧期间抬手丢失。
    fireStart("hold", target);
  }, 350);
}
function onSpeakPressMove(event: unknown) {
  if (!holdOrigin) return;
  const point = readSpeakPoint(event);
  if (Math.abs(point.x - holdOrigin.x) > 12 || Math.abs(point.y - holdOrigin.y) > 12) clearSpeakHold();
}

function onDuplexTap() {
  if (props.leaving || startFired || listenMounted.value) return;
  clearSpeakHold();
  emit('duplex-toggle');
}

/**
 * 点键盘：
 * - `inlineInput`（首页初始页）：在原地把「点击说话」换成文本输入框并聚焦，
 *   不离开初始页；填完点右侧发送才抛 send-text，由父页面决定进对话页的时机；
 * - 否则抛 start-text，父页面照同一套抛物线把常态 logo 送上去再聚焦输入框。
 *
 * 这里不置 startFired：父页面没接这个事件时（如旧版首页）键盘仍然是纯展示，
 * 「点击说话」必须还能用；接了的话父页面会立刻进入 leaving，重复点击自然会被挡住。
 */
function onKeyboardTap() {
  if (props.leaving || startFired) return;
  if (props.inlineInput) {
    void enterTextMode();
    return;
  }
  emit("start-text");
}

/* ===== 文本态（inlineInput）：与对话页底部输入栏同一套「语音 ⇄ 键盘」切换 ===== */

const textMode = ref(false);
const draft = ref("");
const textareaRef = ref<{ focus?: () => void } | null>(null);

const showSend = computed(() => textMode.value && Boolean(draft.value.trim()));

/** 键盘弹起的高度：文本态把整条工具栏顶到键盘上方（页面高度不随键盘压缩） */
const keyboardSpacerHeight = computed(() => (
  textMode.value ? Math.max(0, Number(props.keyboardHeight) || 0) : 0
));

async function enterTextMode() {
  if (textMode.value) return;
  textMode.value = true;
  await nextTick();
  textareaRef.value?.focus?.();
}

function exitTextMode() {
  if (!textMode.value) return;
  textMode.value = false;
  uni.hideKeyboard();
}

function onDraftInput(e: { detail: { value: string } }) {
  draft.value = e.detail.value;
}

/** 发送：只把内容抛给父页面，进不进对话页由父页面决定（首页是「发送后才起飞」） */
function sendDraft() {
  if (props.leaving) return;
  const content = draft.value.trim();
  if (!content) return;
  draft.value = "";
  // 先收键盘：父页面紧接着要播落位动画，键盘继续弹着会让对话页底部跟着上下抽动
  uni.hideKeyboard();
  emit("send-text", content);
}

function onModeTap() {
  if (textMode.value) exitTextMode();
  else onKeyboardTap();
}

onBeforeUnmount(() => {
  clearSpeakHold();
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
});
</script>

<template>
  <view
    class="welcome"
    :class="{ 'welcome--leaving': leaving, 'welcome--landed': landed, 'welcome--dark': dark }"
    :style="safeAreaStyle"
  >
    <view class="welcome__hero">
      <!-- 标题行「Hey,SANI」：直接用设计导出的整行字标，
           浅色 hey-sani-light.svg（106×35）/ 深色 hey-sani-dark.svg（102.69×29） -->
      <view class="welcome__title">
        <image class="welcome__title-img" :src="titleImage" mode="aspectFit" />
      </view>
      <!-- 主视觉：原 306:2783 容器 134×134 / 306:2791 图 110×110，投影 0 3 9 rgba(0,0,0,.14)
           起飞时整组按父页面给的 transform 滑到对话页顶部的灵动岛位置；
           点下去先切成 listen.gif（与对话页灵动岛同一套交叉溶解），再往上走 -->
      <view class="welcome__logo">
        <view class="welcome__logo-fly" :style="logoStyle">
          <!-- 静态图打底：动图就绪前一直显示，就绪后与动图交叉淡出（无感知切换） -->
          <image
            class="welcome__logo-img"
            :class="{
              'welcome__logo-img--covered': saniLogoReady && !logoDeparting,
              'welcome__logo-img--out': logoDeparting,
            }"
            :src="saniLogoStatic"
            mode="aspectFit"
          />
          <!-- 动图：加载期间保持透明（已在后台下载），load 后淡入；起飞时一起让位给 listen 动图 -->
          <image
            class="welcome__logo-img welcome__logo-img--gif"
            :class="{ 'welcome__logo-img--in': saniLogoReady && !logoDeparting }"
            :src="saniLogoWebp"
            mode="aspectFit"
            @load="onSaniLogoLoad"
          />
          <image
            v-if="listenMounted"
            class="welcome__logo-listen"
            :class="{ 'welcome__logo-listen--light': !dark }"
            :src="listenLogoSrc"
            mode="aspectFit"
            @load="onListenLoad"
            @error="onListenLogoError"
          />
        </view>
      </view>
    </view>

    <!-- 底部快捷入口槽位：首页在纯净模式关闭时把对话页那一排胶囊塞进来，
         排在输入条正上方；不传时整块不渲染（作业指导 / 任务协同页保持原样） -->
    <view v-if="$slots.nav" class="welcome__nav">
      <slot name="nav" />
    </view>

    <!-- 底部输入条（Ardot 1204:337 Toolbar）：加号 44×44 + 中间 219×44 + 右侧 44×44，gap 10
         语音态中间是「点击说话」；点键盘后在原地换成文本输入框（不离开初始页），
         填完点右侧发送才抛 send-text 交给父页面 -->
    <view class="welcome__composer">
      <image
        class="welcome__composer-plus"
        @tap.stop="showAttachmentComingSoon"
        src="@/assets/img/icon-plus.svg"
        mode="aspectFit"
      />
      <view v-if="textMode" class="welcome__composer-field">
        <textarea
          ref="textareaRef"
          class="welcome__composer-textarea"
          :value="draft"
          :placeholder="t('input-placeholder')"
          :auto-height="false"
          :adjust-position="false"
          :cursor-spacing="0"
          :hold-keyboard="true"
          :maxlength="-1"
          confirm-type="send"
          placeholder-class="welcome__composer-placeholder"
          @input="onDraftInput"
          @confirm="sendDraft()"
        />
      </view>
      <view
        v-else
        ref="speakButtonRef"
        class="welcome__composer-voice"
        @touchstart="onSpeakPressStart" @touchmove="onSpeakPressMove"
        @touchend="clearSpeakHold" @touchcancel="clearSpeakHold"
        @mousedown="onSpeakPressStart" @mouseup="clearSpeakHold"
        @tap="onSpeakTap"
      >
        <text class="welcome__composer-voice-label">
          {{ t("welcome-tap-to-speak") }}
        </text>
        <!-- 声波芯片（实时语音）：嵌在灰胶囊右端内部，不另占一列（截图 x450..526 / y352..409）；
             未触发点击 = 深色声波（不铺白底），触发后 = 白胶囊 + 蓝色声波 -->
        <view
          v-if="duplexEnabled"
          class="welcome__composer-wave"
          :class="{
            'welcome__composer-wave--active': duplexActive,
            'welcome__composer-wave--starting': duplexStarting,
          }"
          role="button"
          :aria-label="t(duplexActive || duplexStarting ? 'duplex-close' : 'duplex-open')"
          :aria-pressed="duplexActive"
          @touchstart.stop="clearSpeakHold"
          @mousedown.stop="clearSpeakHold"
          @tap.stop="onDuplexTap"
        >
          <image
            class="welcome__composer-wave-icon"
            :src="duplexActive ? voiceWaveActive : waveIconIdle"
            mode="aspectFit"
            aria-hidden="true"
          />
          <view v-if="duplexActive" class="welcome__composer-wave-dot" />
        </view>
      </view>
      <!-- 文本态没有胶囊可内嵌，声波仍旧单独占一列（语音态见胶囊右端的 .welcome__composer-wave） -->
      <view
        v-if="duplexEnabled && textMode"
        class="welcome__composer-kb welcome__composer-duplex"
        :class="{ 'welcome__composer-duplex--starting': duplexStarting }"
        role="button"
        :aria-label="t(duplexActive || duplexStarting ? 'duplex-close' : 'duplex-open')"
        :aria-pressed="duplexActive"
        @tap.stop="onDuplexTap"
      >
        <image
          class="welcome__composer-wave-icon"
          :src="duplexActive ? voiceWaveActive : waveIconIdle"
          mode="aspectFit"
          aria-hidden="true"
        />
        <view v-if="duplexActive" class="welcome__composer-duplex-dot" />
      </view>
      <view
        v-if="!showSend"
        class="welcome__composer-kb"
        :class="{ 'welcome__composer-kb--mic': textMode }"
        @tap="onModeTap"
      >
        <image
          class="welcome__composer-kb-icon"
          :src="textMode ? microphoneIcon : keyboardIcon"
          mode="aspectFit"
        />
      </view>
      <view v-else class="welcome__composer-kb welcome__composer-kb--send" @tap="sendDraft">
        <image class="welcome__composer-kb-icon" :src="sendUpIcon" mode="aspectFit" />
      </view>
    </view>

    <!-- 底部免责提示：固定在输入条下方最后一行，起飞时与标题 / 输入条一起淡出 -->
    <view class="welcome__disclaimer">
      <text class="welcome__disclaimer-text">
        {{ t("welcome-ai-disclaimer") }}
      </text>
    </view>

    <!-- 文本态键盘弹起：页面高度不随键盘压缩，用这段占位把工具栏顶到键盘上方 -->
    <view v-if="keyboardSpacerHeight" :style="{ height: `${keyboardSpacerHeight}px` }" />
  </view>
</template>

<style lang="scss" scoped>
/* 起飞动画期间要和「对话页」同时存在：欢迎层铺满视口并压在上面，
   底色与对话页同为 #fafafa，淡出时不会看到闪白/闪黑 */
.welcome {
  position: fixed;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: var(--safe-top-px, 0px);
  padding-top: max(var(--safe-top-px, 0px), env(safe-area-inset-top));
  // 与问答页底部一致：提示文字底边到页面底边 15px
  padding-bottom: calc(30rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(30rpx + env(safe-area-inset-bottom));
  overflow: hidden;
  background: #fafafa;
  color: #0d0d0d;
  font-family: "PingFang SC", sans-serif;
  transition: background-color 360ms ease;
}

/* 起飞态：底色让位（下面的对话页露出来），文字与输入条先淡出，只有 logo 继续往上滑 */
.welcome--leaving {
  background: transparent;
  pointer-events: none;
}

.welcome--leaving .welcome__title,
.welcome--leaving .welcome__nav,
.welcome--leaving .welcome__composer,
.welcome--leaving .welcome__disclaimer {
  opacity: 0;
  transition: opacity 240ms ease;
}

/* 标题 + 图标一组，垂直水平居中；底部输入条固定占最后一行 */
.welcome__hero {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10rpx; // 5px
  min-height: 0;
}

/* ===== 标题行「Hey,SANI」=====
   整行直接贴设计导出的字标（颜色、渐变、字距都在图里，不再用文字 + background-clip 拼）：
   - 浅色 hey-sani-light.svg：106×35 → 212×70rpx；
   - 深色 hey-sani-dark.svg：102.69×29 → 206×58rpx（深色稿字号小一档，尺寸分开写） */
.welcome__title {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 240ms ease;
}

.welcome__title-img {
  width: 212rpx; // 106px
  height: 70rpx; // 35px
}

.welcome--dark .welcome__title-img {
  width: 206rpx; // 102.69px
  height: 58rpx; // 29px
}

.welcome__logo {
  display: flex;
  box-sizing: border-box;
  width: 268rpx; // 134px
  height: 268rpx;
  align-items: center;
  justify-content: center;
  padding: 24rpx; // 12px
}

/* 飞行层：两张动图叠在同一个 110×110 盒子里，整组一起被 transform 带走
   （transform 放在包裹层上，换图 / 交叉溶解都不会打断位移补间） */
.welcome__logo-fly {
  position: relative;
  width: 220rpx; // 110px
  height: 220rpx;
  // 位移由父页面的 rAF 逐帧写入（抛物线 + 先放大后收小），这里不能再给 transform
  // 加 transition，否则每帧都会被补间拖住；只保留到顶淡出用的 opacity 过渡
  transition: opacity 160ms ease;
  will-change: transform, opacity;
}

.welcome__logo-img,
.welcome__logo-listen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.welcome__logo-img {
  // 透明 PNG 用 drop-shadow 才能沿三角轮廓投影
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
  transition: opacity 220ms ease;
}

/* 点「点击说话」后常态图淡出，让给 listen.gif；
   动图就绪时静态图也走这里淡出，与 --in 的动图交叉溶解 */
.welcome__logo-img--out {
  opacity: 0;
  transition: opacity 360ms ease;
}

/* 动图层：未就绪前整体透明（图片已在下载），load 后由 --in 淡入。
   与静态图的淡出同步，视觉上只是图标从静止变成动态，不出现空白或跳变 */
.welcome__logo-img--gif {
  opacity: 0;
  pointer-events: none;
}

.welcome__logo-img--in {
  opacity: 1;
}

/* 动图接管后静态图淡出：与 --in 同为 220ms，两张图同步交叉，不出现重叠重影 */
.welcome__logo-img--covered {
  opacity: 0;
}

/* 深色 listen-dark.webp 图案占画布 40.5%（与旧 gif 同规格），aspectFit 后图案会小一半多；
   按「图案宽度对齐 sani-logo」放大 2.49 倍，并把图案中心偏左上补回来（与灵动岛同一套换算） */
.welcome__logo-listen {
  opacity: 0;
  pointer-events: none;
  transform: translate(3.5rpx, 3.5rpx) scale(2.36);
  filter: drop-shadow(0 2.4rpx 7.2rpx rgba(0, 0, 0, 0.14));
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

/* 溶解/放大要在「扩散到最大」之前跑完：峰值在点击后 480ms（见 index.vue 的
   WELCOME_LISTEN_PEAK_MS），这里给 400ms，留 80ms 让整张图已经满不透明 */
.welcome--leaving .welcome__logo-listen {
  opacity: 1;
  transform: translate(3.5rpx, 3.5rpx) scale(2.49);
  transition:
    opacity 400ms cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 400ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 浅色 listen-light.webp（480×480）：图案占画布 60.5%，是 gif 41% 的 1.48 倍，
   同一个盒子里只需放大 2.49 / 1.48 ≈ 1.69 倍；图案中心偏右 2.2%，
   按 1.69 倍折算左移，welcome 的盒子比灵动岛大约 1.75 倍，取 -5rpx */
.welcome__logo-listen--light {
  transform: translate(-5rpx, 3.5rpx) scale(1.6);
}

.welcome--leaving .welcome__logo-listen--light {
  opacity: 1;
  transform: translate(-5rpx, 3.5rpx) scale(1.69);
}

/* 到顶后整组淡出：对话页自己的灵动岛图标在同一位置、同一尺寸接上，
   落位处即使有 1-2px 误差也看不出来，不会出现「冲过头再往下掉」 */
.welcome--landed .welcome__logo-fly {
  opacity: 0;
}

/* 快捷入口槽位：胶囊导航自带底色 / 内边距 / 高度，这里只负责在 flex 列里占一行 */
.welcome__nav {
  flex: none;
  width: 100%;
  transition: opacity 240ms ease;
}

/* ===== 底部输入条：加号 / 点击说话 / 键盘 =====
   尺寸与问答页 .input-bar 语音态完全同一套（上下 8px / 左右 20px、min-height 64px、间距 10px），
   两页来回切时这一行的高度、按钮大小、图标大小都不许变 */
.welcome__composer {
  display: flex;
  flex: none;
  width: 100%;
  align-items: center;
  gap: 20rpx; // 10px
  min-height: 128rpx; // 64px
  padding: 16rpx 48rpx; // 上下 8px / 左右 24px（截图：加号左边距 96−57=39px÷1.63≈24px）
  box-sizing: border-box;
  transition: opacity 240ms ease;
}

/* 加号：icon-plus.svg 自带 44×44 圆底（#0D0D0D 3.61%）与十字 */
.welcome__composer-plus {
  flex: 0 0 88rpx;
  width: 88rpx; // 44px
  height: 88rpx;
}

/* 中间的「点击说话」胶囊：44px 高 / 圆角 45px / #0D0D0D 3.61%（叠在 #FAFAFA 上渲染为 #F1F1F1）
   截图实测：胶囊 x184..539（≈218px 宽）、y345..416（44px 高），右侧内嵌声波芯片 */
.welcome__composer-voice {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  height: 88rpx;
  align-items: center;
  justify-content: flex-start;
  padding: 0 120rpx 0 36rpx; // 左 18px（截图文字起于 x213）；右留出声波芯片 96rpx + 16rpx
  box-sizing: border-box;
  border-radius: 90rpx;
  background: rgba(13, 13, 13, 0.0361);
}

/* 文案色取截图最暗像素 #5E5E5E（14px Regular，左对齐起排） */
.welcome__composer-voice-label {
  color: #5e5e5e;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx;
  text-align: left;
}

/* 声波芯片（实时语音）：截图 x450..526 / y352..409 → 48×36px 胶囊（圆角 18px），
   右内边距 8px、垂直居中；里面是 20×20 的 6 段声波。
   未触发点击时**不铺白底**（直接落在灰胶囊上、图标走深色），触发后才出现白胶囊 + 蓝色声波 */
.welcome__composer-wave {
  position: absolute;
  top: 50%;
  right: 16rpx; // 8px
  display: flex;
  width: 96rpx; // 48px
  height: 72rpx; // 36px
  align-items: center;
  justify-content: center;
  border-radius: 36rpx; // 18px，两端半圆
  background: transparent;
  transform: translateY(-50%);
}

/* 已触发（实时语音进行中）：白色胶囊 + 蓝色声波 */
.welcome__composer-wave--active {
  background: #ffffff;
}

.welcome__composer-wave-icon {
  width: 40rpx; // 20px，与键盘图标同尺寸（截图声波竖条间距 3.33px × 6）
  height: 40rpx;
}

.welcome__composer-wave--starting {
  opacity: 0.55;
}

.welcome__composer-wave-dot {
  position: absolute;
  top: 0;
  right: 0;
  width: 18rpx;
  height: 18rpx;
  border: 2px solid #fafafa;
  border-radius: 50%;
  background: #20c56c;
}

/* 键盘：44×44 圆钮，底色与胶囊同一材质 */
.welcome__composer-kb {
  display: flex;
  flex: 0 0 88rpx;
  width: 88rpx;
  height: 88rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(13, 13, 13, 0.0361);
}

.welcome__composer-kb-icon {
  width: 40rpx; // 20px，与问答页 .input-bar__mode image 同尺寸
  height: 40rpx;
}

.welcome__composer-duplex {
  position: relative;
}

.welcome__composer-duplex:active {
  opacity: 0.7;
}

.welcome__composer-duplex--starting {
  opacity: 0.55;
}

.welcome__composer-duplex-dot {
  position: absolute;
  top: 0;
  right: 0;
  width: 18rpx;
  height: 18rpx;
  border: 2px solid #fafafa;
  border-radius: 50%;
  background: #20c56c;
}

/* 文本态：中间换成可输入的胶囊，材质 / 高度 / 圆角与「点击说话」完全一致 */
.welcome__composer-field {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 88rpx;
  align-items: center;
  padding: 0 28rpx; // 14px，与问答页文本胶囊的左内边距接近
  box-sizing: border-box;
  border-radius: 90rpx;
  background: rgba(13, 13, 13, 0.0361);
}

.welcome__composer-textarea {
  width: 100%;
  height: 40rpx;
  min-height: 40rpx;
  color: #0d0d0d;
  font-size: 28rpx; // 14px
  line-height: 40rpx;
  background: transparent;
}

/* uni H5 的 <textarea> 实际是 uni-textarea 外壳 + 内层原生 textarea，
   内层也要吃同一套高度 / 字号，否则会撑到默认 150px */
.welcome__composer-textarea :deep(textarea) {
  height: 40rpx;
  min-height: 40rpx;
  color: inherit;
  font-size: inherit;
  line-height: 40rpx;
  background: transparent;
}

.welcome__composer-placeholder {
  color: #8e8e8e;
  font-size: 28rpx;
}

/* 文本态有内容时单独显示发送按钮。 */
.welcome__composer-kb--send {
  background: transparent;
}

.welcome__composer-kb--send .welcome__composer-kb-icon {
  width: 70rpx; // 35px，与问答页文本态发送钮同尺寸
  height: 70rpx;
}

/* ===== 底部免责提示：输入条下方 12px，12px / 17px 浅灰居中 =====
   不再吃 flex:1，固定在最后一行；起飞时跟着标题 / 输入条一起淡出 */
.welcome__disclaimer {
  display: flex;
  flex: none;
  justify-content: center;
  margin-top: 16rpx; // 8px，与问答页 .chat-input__footer 的上间距一致
  padding: 0 40rpx;
  transition: opacity 240ms ease;
}

.welcome__disclaimer-text {
  color: #9a9a9a;
  font-size: 24rpx; // 12px
  font-weight: 400;
  line-height: 34rpx; // 17px
  text-align: center;
}

/* ===== 深色模式（宿主 getColorScheme = dark）=====
   与对话页 .ai-page--dark 同一套底色 #0D0D0D，
   只换底色与材质，间距 / 字号 / 圆角与浅色稿一致；
   初始页原来只有一套浅色样式，深色宿主下会先闪一整屏 #FAFAFA 再切到深色对话页。 */
.welcome--dark {
  background: #0d0d0d;
  color: #f2f3f5;
}

/* 起飞态仍然要让位给下面的问答页：深色底不能把它盖住 */
.welcome--dark.welcome--leaving {
  background: transparent;
}

/* 标题行深色稿不再需要额外覆盖：hey-sani-dark.svg 自己就是深色那套白字标 */

/* 输入条控件的材质换成「白色 8%」：浅色稿的 #0D0D0D 3.61% 在深底上等于没有 */
.welcome--dark .welcome__composer-voice,
.welcome--dark .welcome__composer-field,
.welcome--dark .welcome__composer-kb {
  background: rgba(255, 255, 255, 0.08);
}

/* 文本态有内容的发送钮是实心图标，不跟着铺底板 */
.welcome--dark .welcome__composer-kb--send {
  background: transparent;
}

/* 声波芯片：触发后浅色稿是纯白底，深底上换成 14% 白；未触发态透明（图标本身按主题换成白波） */
.welcome--dark .welcome__composer-wave--active {
  background: rgba(255, 255, 255, 0.14);
}

.welcome--dark .welcome__composer-voice-label {
  color: #f2f3f5;
}

.welcome--dark .welcome__composer-textarea {
  color: #f2f3f5;
}

.welcome--dark .welcome__composer-placeholder {
  color: #6b6b6b; // 与问答页深色 placeholder 同色
}

/* 加号 / 键盘图标本身是深色图形：深底上反色，圆底与十字一起变浅 */
.welcome--dark .welcome__composer-plus,
.welcome--dark .welcome__composer-kb-icon {
  filter: invert(1);
}

.welcome__composer-kb--mic .welcome__composer-kb-icon {
  filter: brightness(0) invert(5.1%);
}

.welcome--dark .welcome__composer-kb--mic .welcome__composer-kb-icon {
  filter: brightness(0) invert(1);
}

/* 主视觉的投影：浅色稿是黑 14%，深底上等于没有，加浓一档让三角浮起来 */
.welcome--dark .welcome__logo-img {
  filter: drop-shadow(0 6rpx 24rpx rgba(0, 0, 0, 0.55));
}

.welcome--dark .welcome__disclaimer-text {
  color: rgba(255, 255, 255, 0.45);
}
</style>
