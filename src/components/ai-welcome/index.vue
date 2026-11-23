<script setup lang="ts">
import type { PropType } from "vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
// 中心 SANI 图标静态图：动图就绪前先打底，避免 1MB 的 webp 慢网下先空白
import saniLogoStatic from "@/assets/img/header-island-logo.png";
import keyboardIcon from "@/assets/img/icon-keyboard-dark.svg";
import microphoneIcon from "@/assets/img/icon-mic-red.svg";
import sendUpIcon from "@/assets/img/icon-send-up.svg";
import voiceWaveLight from "@/assets/img/icon-voice-wave-light.svg";
import voiceWaveOnDark from "@/assets/img/icon-waveform-darck.svg";
// 起飞段的中间大图与对话页灵动岛用同一套深浅色 webp（图案占比不同，样式里已按主题补偿 scale）
import listenLogoDark from "@/assets/img/listen-dark.webp";
import listenLogoLight from "@/assets/img/listen-light.webp";
import listenLogo from "@/assets/img/listen.gif";
// 动图加载完成后与静态图交叉溶解，用户只看到「图标从静止变动态」
import saniLogoWebp from "@/assets/img/sani-logo.webp";
import titleDark from "@/assets/img/sany-neo-dark.svg";
import titleLight from "@/assets/img/sany-neo-light.svg";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSettingsStore } from "@/stores";
import { showAttachmentComingSoon } from "@/utils/attachment-notice";
import { suppressNextClick } from "@/utils/suppress-next-click";
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
  /** 起飞态：底色让位给下面的对话页，logo 按 logoStyle 滑向顶部 */
  leaving: { type: Boolean, default: false },
  /**
   * 图标真正开始往上飞（起飞前还有一段 listen 扩散的停留）。
   * 标题 / 标语 / 输入条跟着这一步淡出，与参考录屏一致 ——
   * 点下去文字先留着，图标飞起时才一起让位，而不是点击瞬间就清空。
   */
  flying: { type: Boolean, default: false },
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
  (e: "input-focus"): void;
  (e: "input-blur"): void;
}>();

const { t } = useI18n();
const { safeAreaStyle } = useSafeArea();
/** 纯净模式：开着时底部没有快捷入口胶囊，深色渐变带可以再往下多铺一截（与对话页输入栏同口径） */
const { pureMode } = storeToRefs(useSettingsStore());

/**
 * 「Hey,SANI」整行字标：直接用设计导出的整行图，不再用文字 + background-clip 拼。
 * 按主题切图：浅色 `sany-neo-light.svg`、深色 `sany-neo-dark.svg`（都是 120×29 的整行字标）。
 */
const titleImage = computed(() => (props.dark ? titleDark : titleLight));

/**
 * 标语 / 副标题按字符拆开：起飞时逐字做波浪扭曲。
 * 录屏里文字是被图标「拉扯」的液态变形（有的字被拉宽上浮、有的缩小下沉），
 * 整段文字统一 skew 出不来这种效果，只能按字给不同相位。
 */
const sloganChars = computed(() => Array.from(t("init-brand-slogan")));

/**
 * 声波图标（纯展示，点击等同「点击说话」）按主题取图：
 * 浅色主题 `icon-voice-wave-light.svg`（白胶囊 + 灰声波），深色主题 `icon-waveform-darck.svg`（纯白声波）。
 */
const waveIconIdle = computed(() => (props.dark ? voiceWaveOnDark : voiceWaveLight));

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
/** listen 图真正可显示（load / 退回 gif 后 load）：没就绪前飞行继续用 sani 动图，不露空 */
const listenReady = ref(false);
/**
 * listen 图接管常态图：必须等到图片真就绪才切换。
 * 之前直接跟着 leaving 走 —— 常态图淡出了、listen 图还在下载中，
 * 飞上去的半天是静态 png 的残影甚至空白，到顶才换成 sani-logo.webp。
 */
const listenShowing = computed(() => props.leaving && listenMounted.value && listenReady.value);
/** 兜底时长：个别容器命中缓存不派发 load，不能让页面卡在欢迎页 */
const LISTEN_READY_TIMEOUT_MS = 120;

/**
 * 起飞段中间那张 listen 图：与对话页灵动岛同一套深浅色 webp，老内核不认 webp 时退回 gif。
 * 模板一直引用着 `listenLogoSrc` / `onListenLogoError`，这两个必须是真实定义：
 * 否则 `:src` 拿到 undefined，常态 logo 又已经淡出，飞起来的是一张空图 ——
 * 表现就是「点说话直接切到对话页录音态，中间动效不见了」。
 */
const listenLogoFailed = ref(false);
const listenLogoSrc = computed(() => {
  if (listenLogoFailed.value) return listenLogo;
  return props.dark ? listenLogoDark : listenLogoLight;
});
/**
 * 常态就预热 listen 图：真机上点击时才开始下载 1MB 级 webp 大概率来不及，
 * 起飞时它还没就绪就只能靠 sani 动图兜底，光晕扩散那一段就没了。
 */
const listenPreloaded = new Set<string>();
watch(() => listenLogoSrc.value, (src) => {
  if (typeof Image === "undefined" || !src || listenPreloaded.has(src)) return;
  listenPreloaded.add(src);
  new Image().src = src;
}, { immediate: true });
/** 加载失败：换回 gif，同时立刻放行起飞（src 换掉后不会再派发 load，别等兜底定时器） */
function onListenLogoError() {
  listenLogoFailed.value = true;
  listenReady.value = false;
  fireStart();
}

let startFired = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * 底部输入条（加号 + 点击说话/输入框 + 右侧图标）是否收起：
 * 点「点击说话」或键盘填完点发送后立刻收掉，不等 --flying 的淡出，
 * 否则起飞/落位那一帧这一行还压在对话页底部。回到初始页时复位。
 */
const composerHidden = ref(false);

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
  listenReady.value = true;
  if (listenMounted.value) fireStart();
}

/**
 * 起飞：挂上 listen.gif 从第 0 帧起播，首帧就绪再抛 start-chat ——
 * 父页面据此把起飞时刻对齐「扩散到最大」。点「点击说话」直接走这里。
 */
function beginDepart() {
  if (startFired) return;
  // 先收掉底部这一行：父页面马上要播起飞/落位，等 --flying 再淡出会多留一帧压在对话页上
  composerHidden.value = true;
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

/**
 * 抬手收尾（pointerup 通道）：胶囊和输入栏那颗一样带 `touch-action: none`，
 * 部分 WebView 会把随后的 click(tap) 吞掉，这里补一次「点击说话」。
 * `startFired` 已拦住长按起飞后的重复触发。
 */
function onSpeakRelease() {
  clearSpeakHold();
  if (props.leaving || startFired) return;
  // 抬手即起飞：这一手势随后补发的 click 会落到刚出现的对话页元素上，先吞掉
  suppressNextClick();
  onSpeakTap();
}

watch(() => props.leaving, leaving => {
  // 退回初始页（离开起飞态）时把输入条放回来，下一轮还要能点
  if (!leaving) composerHidden.value = false;
});

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

/**
 * 键盘弹起的高度：文本态把整条工具栏顶到键盘上方。
 *
 * 宿主给的 keyboardHeight 是「键盘占了多高」，但本层是 `position: fixed`：
 * 在会把布局视口一起压短的 WebView（Android adjustResize 这类）里，层的下沿本来就
 * 已经贴到键盘上沿了，再整段补一个键盘高度，输入条就被顶到屏幕上方去（实测多顶近一个键盘高）。
 *
 * 所以先按键盘高度铺，一帧后实测「占位块的上沿离可视区底部还差多少」再修正一次：
 * 多顶出来（超过阈值）就把占位收掉相应高度；本来就贴着键盘（iOS 这类布局视口不缩的容器）则不动。
 */
const SPACER_EDGE_GAP_PX = 8;
const SPACER_OVERLIFT_TOLERANCE_PX = 24;

const spacerRef = ref<unknown>(null);
/** 键盘高度原值 */
const rawSpacerPx = computed(() => (
  textMode.value ? Math.max(0, Number(props.keyboardHeight) || 0) : 0
));
/** 实测多顶上去的量，只往下收、不额外补 */
const overLiftPx = ref(0);
const keyboardSpacerHeight = computed(() => Math.max(0, rawSpacerPx.value - overLiftPx.value));

function readSpacerEl(raw: unknown): HTMLElement | null {
  if (!raw) return null;
  if (typeof HTMLElement !== "undefined" && raw instanceof HTMLElement) return raw;
  const el = (raw as { $el?: unknown }).$el;
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el : null;
}

let spacerMeasureTimers: Array<ReturnType<typeof setTimeout>> = [];
function clearSpacerMeasure() {
  spacerMeasureTimers.forEach(timer => clearTimeout(timer));
  spacerMeasureTimers = [];
}

/** 占位块的上沿应该正好落在可视区底部：高出来多少就收掉多少 */
function correctSpacerIfOverLifted() {
  const el = readSpacerEl(spacerRef.value);
  const viewport = typeof window !== "undefined" ? window.visualViewport : null;
  if (!el || !viewport) return;
  const visibleBottom = Math.round(viewport.height + viewport.offsetTop);
  const surplus = visibleBottom - Math.round(el.getBoundingClientRect().top);
  if (surplus <= SPACER_OVERLIFT_TOLERANCE_PX) return;
  overLiftPx.value = Math.min(rawSpacerPx.value, overLiftPx.value + (surplus - SPACER_EDGE_GAP_PX));
}

watch(
  () => [props.keyboardHeight, textMode.value] as const,
  async ([height, active]) => {
    clearSpacerMeasure();
    overLiftPx.value = 0;
    if (!active || !(Number(height) > 0)) return;
    await nextTick();
    // 键盘动画期间报上来的高度还会变，量三次兜底（每次都是从「已修正后的位置」再算差值）
    requestAnimationFrame(correctSpacerIfOverLifted);
    spacerMeasureTimers.push(setTimeout(correctSpacerIfOverLifted, 260));
    spacerMeasureTimers.push(setTimeout(correctSpacerIfOverLifted, 520));
  },
);

async function enterTextMode() {
  if (textMode.value) return;
  textMode.value = true;
  await nextTick();
  textareaRef.value?.focus?.();
}

function exitTextMode() {
  if (!textMode.value) return;
  textMode.value = false;
  emit("input-blur");
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
  // 与「点击说话」一致：这一行立刻收掉，不留到起飞淡出
  composerHidden.value = true;
  // 先收键盘：父页面紧接着要播落位动画，键盘继续弹着会让对话页底部跟着上下抽动
  uni.hideKeyboard();
  emit("send-text", content);
  emit("input-blur");
}

function onModeTap() {
  if (textMode.value) exitTextMode();
  else onKeyboardTap();
}

onBeforeUnmount(() => {
  clearSpeakHold();
  clearSpacerMeasure();
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
});
</script>

<template>
  <view
    class="welcome"
    :class="{
      'welcome--leaving': leaving,
      'welcome--flying': flying,
      'welcome--landed': landed,
      'welcome--dark': dark,
      'welcome--pure': pureMode,
    }"
    :style="safeAreaStyle"
  >
    <view class="welcome__hero">
      <!-- 标题行「Hey,SANI」：设计导出的整行字标，浅色 sany-neo-light.svg / 深色 sany-neo-dark.svg -->
      <view class="welcome__title">
        <image class="welcome__title-img" :src="titleImage" mode="aspectFit" />
      </view>
      <!-- 主视觉：原 306:2783 容器 134×134 / 306:2791 图 110×110，投影 0 3 9 rgba(0,0,0,.14)
           起飞时整组按父页面给的 transform 滑到对话页顶部的灵动岛位置；
           点下去先切成 listen.gif（与对话页灵动岛同一套交叉溶解），再往上走 -->
      <view class="welcome__logo">
        <view class="welcome__logo-fly" :style="logoStyle">
          <!-- 静态图打底：listen 动图就绪接管前都不撤（哪怕 webp 还没加载完），飞行中不露空 -->
          <image
            class="welcome__logo-img"
            :class="{
              'welcome__logo-img--covered': saniLogoReady && !listenShowing,
              'welcome__logo-img--out': listenShowing,
            }"
            :src="saniLogoStatic"
            mode="aspectFit"
          />
          <!-- 动图：加载期间保持透明（已在后台下载），load 后淡入；
               起飞时若 listen 图还没就绪，由它继续飞，就绪后再交叉让位 -->
          <image
            class="welcome__logo-img welcome__logo-img--gif"
            :class="{ 'welcome__logo-img--in': saniLogoReady && !listenShowing }"
            :src="saniLogoWebp"
            mode="aspectFit"
            @load="onSaniLogoLoad"
          />
          <image
            v-if="listenMounted"
            class="welcome__logo-listen"
            :class="{
              'welcome__logo-listen--light': !dark,
              'welcome__logo-listen--on': listenShowing,
            }"
            :src="listenLogoSrc"
            mode="aspectFit"
            @load="onListenLoad"
            @error="onListenLogoError"
          />
        </view>
      </view>

      <!-- 品牌文案组：图标下方只留「随时，为你而在」，
           副标题「你的三一设备伙伴」已按需求去掉（i18n 的 init-brand-desc-1 不再使用） -->
      <view class="welcome__caption">
        <!-- 逐字拆开：起飞时每个字按相位做波浪扭曲（录屏里文字是被「拉扯」变形的，
             整段文字整体 skew 做不出这种不均匀形变） -->
        <text class="welcome__slogan">
          <text
            v-for="(ch, i) in sloganChars"
            :key="`slogan-${i}`"
            class="welcome__char"
            :class="`welcome__char--p${i % 4}`"
          >{{ ch }}</text>
        </text>
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
    <view class="welcome__composer" :class="{ 'welcome__composer--hidden': composerHidden }">
      <view class="welcome__composer-plus" @tap.stop="showAttachmentComingSoon">
        <image
          class="welcome__composer-plus-icon"
          src="@/assets/img/icon-plus.svg"
          mode="aspectFit"
        />
      </view>
      <view
        v-if="textMode"
        class="welcome__composer-field"
        :class="{ 'welcome__composer-field--with-wave': duplexEnabled }"
      >
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
          @focus="emit('input-focus')"
          @blur="emit('input-blur')"
          @confirm="sendDraft()"
        />
        <!-- 声波图标（纯展示，不再做实时语音开关）：点在图标上等同点整条胶囊（点击说话） -->
        <view
          v-if="duplexEnabled"
          class="welcome__composer-wave welcome__composer-wave--passive"
        >
          <image
            class="welcome__composer-wave-icon"
            :src="waveIconIdle"
            mode="aspectFit"
            aria-hidden="true"
          />
        </view>
      </view>
      <view
        v-else
        ref="speakButtonRef"
        class="welcome__composer-voice"
        @touchstart="onSpeakPressStart" @touchmove="onSpeakPressMove"
        @touchend="clearSpeakHold" @touchcancel="clearSpeakHold"
        @pointerdown="onSpeakPressStart" @pointermove="onSpeakPressMove"
        @pointerup="onSpeakRelease" @pointercancel="clearSpeakHold"
        @mousedown="onSpeakPressStart" @mouseup="clearSpeakHold"
        @tap="onSpeakTap"
      >
        <text class="welcome__composer-voice-label">
          {{ t("welcome-tap-to-speak") }}
        </text>
        <!-- 声波图标（纯展示，不再做实时语音开关）：点在图标上等同点整条胶囊（点击说话） -->
        <view
          v-if="duplexEnabled"
          class="welcome__composer-wave welcome__composer-wave--passive"
        >
          <image
            class="welcome__composer-wave-icon"
            :src="waveIconIdle"
            mode="aspectFit"
            aria-hidden="true"
          />
        </view>
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

    <!-- 文本态键盘弹起：用这段占位把工具栏顶到键盘上方；
         ref 给的是「实测修正」用（见 keyboardSpacerHeight 的说明） -->
    <view
      v-if="keyboardSpacerHeight"
      ref="spacerRef"
      :style="{ height: `${keyboardSpacerHeight}px` }"
    />
  </view>
</template>

<style lang="scss" scoped>
.welcome__composer-wave {
  touch-action: none;
  user-select: none;
}

/* 声波图标只做展示：点在图标上等同点整条胶囊（点击说话） */
.welcome__composer-wave--passive {
  pointer-events: none;
}

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
  // 底部「加号 + 点击说话 + 键盘」这一整条带（含下方免责提示与安全区）叠一层
  // 「上透明 → 下 50% 蓝」的渐变，与对话页输入栏、录音态底部光晕同一条色。
  // 只给最下面这一条带铺（background-size），整屏底色仍是纯 #fafafa。
  // 带高 = 输入条 128rpx + 提示上间距 16rpx + 提示行 34rpx + 根容器底部留白 30rpx = 208rpx，
  // 再收 32rpx（16px）：渐变上沿落在「底部快捷入口胶囊」下沿再往下 32rpx，
  // 胶囊那一行与渐变之间留一条纯 #fafafa 的空隙，蓝光不贴到胶囊上。
  background-color: #fafafa;
  background-image: linear-gradient(180deg, rgba(135, 198, 255, 0) 0%, rgba(135, 198, 255, 0.5) 100%);
  background-repeat: no-repeat;
  background-position: center bottom;
  background-size: 100% 176rpx;
  background-size: 100% calc(176rpx + env(safe-area-inset-bottom));
  color: #0d0d0d;
  font-family: "PingFang SC", sans-serif;
  transition: background-color 360ms ease;

  // 中间那枚半圆只有深色模式才铺（浅色按要求去掉白底），声明见下方 .welcome--dark::before
}

/* 纯净模式（初始页）：底部没有快捷入口胶囊，渐变带往下多铺 4rem（浅色 / 深色同一口径），
   与对话页 .chat-input--pure::before 的 calc(100% - -4rem) 同口径；
   关闭纯净模式仍是基类的 176rpx + 安全区。
   深色那条要写成两个类，才能压过下面 .welcome--dark 里的 background-size */
.welcome--pure,
.welcome--pure.welcome--dark {
  background-size: 100% calc(176rpx + env(safe-area-inset-bottom) + 4rem);
}

/* 起飞态：底色先让位（下面的对话页露出来），文字留着 ——
   等图标真正开始上升（--flying）再一起淡出 */
.welcome--leaving {
  background: transparent;
  pointer-events: none;
}

/* 起飞时底部光晕与半圆一起收掉，否则会留一块白斑压在对话页底部 */
.welcome--leaving::before {
  content: none;
}

/* 文字随飞行淡出：对齐录屏实测 —— 前 200ms 几乎不变暗，末段 120ms 内快速消失，
   边缘同时轻微发散（模糊）。所以用 ease-in 曲线（前慢后快），
   观感是「图标飞过标题时把文字带走」，而不是一上来就整片变淡。 */
.welcome--flying .welcome__title,
.welcome--flying .welcome__caption {
  opacity: 0;
  filter: blur(1.2px);
  transition:
    opacity 320ms cubic-bezier(0.55, 0, 1, 0.45),
    filter 320ms cubic-bezier(0.55, 0, 1, 0.45);
}

/* 输入条与免责声明只走透明度：它们和对话页同位置的控件压在一起，
   模糊会让人看出两层轮廓 */
.welcome--flying .welcome__nav,
.welcome--flying .welcome__composer,
.welcome--flying .welcome__disclaimer {
  opacity: 0;
  transition: opacity 320ms cubic-bezier(0.55, 0, 1, 0.45);
}

/* ===== 起飞瞬间的文字扭曲 =====
   录屏里文字不是整体平移/缩放，而是像被图标「拉扯」：有的字被拉宽上浮、
   相邻的字缩小下沉，越靠近图标越明显。整段文字统一 skew 出不来，
   所以标语 / 副标题按字符拆开，四组相位轮流（奇偶反向），
   在 320ms 内先扭出去再回正，和淡出叠加就是「扭着散掉」。 */
.welcome__char {
  display: inline-block;
  white-space: pre;
}

.welcome--flying .welcome__char {
  animation: welcome-char-warp 320ms cubic-bezier(0.55, 0, 1, 0.45) both;
}

/* 四组相位：错开起步时间、上下反向、幅度各不相同 ——
   录屏里相邻的字并不是同频抖动，而是有的被拉宽上浮、有的被压缩下沉 */
.welcome__char--p0 {
  --warp-dir: 1;
  --warp-amp: 1.15;
  animation-delay: 0ms;
}

.welcome__char--p1 {
  --warp-dir: -1;
  --warp-amp: 0.8;
  animation-delay: 12ms;
}

.welcome__char--p2 {
  --warp-dir: 1;
  --warp-amp: 1;
  animation-delay: 24ms;
}

.welcome__char--p3 {
  --warp-dir: -1;
  --warp-amp: 0.9;
  animation-delay: 36ms;
}

@keyframes welcome-char-warp {
  0% {
    transform: translateY(0) scale(1) skewX(0deg);
  }

  35% {
    transform:
      translateY(calc(-4px * var(--warp-dir) * var(--warp-amp, 1) * var(--warp-small, 1)))
      scale(calc(1 + 0.3 * var(--warp-amp, 1) * var(--warp-small, 1)), calc(1 + 0.1 * var(--warp-amp, 1) * var(--warp-small, 1)))
      skewX(calc(-8deg * var(--warp-dir) * var(--warp-amp, 1) * var(--warp-small, 1)));
  }

  70% {
    transform:
      translateY(calc(2px * var(--warp-dir) * var(--warp-amp, 1) * var(--warp-small, 1)))
      scale(calc(1 - 0.12 * var(--warp-amp, 1) * var(--warp-small, 1)), calc(1 - 0.04 * var(--warp-amp, 1) * var(--warp-small, 1)))
      skewX(calc(4deg * var(--warp-dir) * var(--warp-amp, 1) * var(--warp-small, 1)));
  }

  100% {
    transform: translateY(0) scale(1) skewX(0deg);
  }
}

/* 标题是整行 SVG 字标（无法逐字拆），用整体 skew + scaleX 抖一次，
   近似录屏里「Neo 被拉宽、N 错位」的观感 */
.welcome--flying .welcome__title-img {
  animation: welcome-title-warp 320ms cubic-bezier(0.55, 0, 1, 0.45) both;
}

@keyframes welcome-title-warp {
  0% {
    transform: skewX(0deg) scaleX(1);
  }

  32% {
    transform: skewX(-6deg) scaleX(1.06);
  }

  66% {
    transform: skewX(3deg) scaleX(0.97);
  }

  100% {
    transform: skewX(0deg) scaleX(1);
  }
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
   字标自身 120×29px（sany-neo-light / sany-neo-dark 同尺寸），盒子按 126×37px
   （252×74rpx）给，`aspectFit` 等比装入 —— 视觉宽度仍与旧图 126px 一致，行高不跳。 */
.welcome__title {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 240ms ease;
}

.welcome__title-img {
  width: 252rpx; // 126px
  height: 74rpx; // 37px
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
   WELCOME_LISTEN_PEAK_MS），这里给 400ms，留 80ms 让整张图已经满不透明。
   用 --on（图片就绪）而不是 leaving 触发：图片还在下载时亮 opacity:1 也是空白 */
.welcome__logo-listen--on {
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

.welcome__logo-listen--light.welcome__logo-listen--on {
  opacity: 1;
  transform: translate(-5rpx, 3.5rpx) scale(1.69);
}

/* 到顶后整组淡出：对话页自己的灵动岛图标在同一位置、同一尺寸接上，
   落位处即使有 1-2px 误差也看不出来，不会出现「冲过头再往下掉」 */
.welcome--landed .welcome__logo-fly {
  opacity: 0;
}

/* ===== 图标下方的品牌文案组（浅色稿：标语 #0D0D0D 加粗 + 两行 #8E8E8E）=====
   与图标之间：logo 盒内边距 24rpx + hero gap 10rpx + 这里 50rpx ≈ 84rpx（42px），
   对齐设计里「三角底 → 标语顶」的留白 */
.welcome__caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx; // 2px
  transition: opacity 240ms ease;
}

.welcome__slogan {
  color: #0d0d0d;
  font-size: 36rpx; // 17px
  font-weight: 500;
  line-height: 48rpx; // 24px
  text-align: center;
  // 标语单独上提 10rpx（5px）：用 transform 而不是 margin —— 位移不参与布局，
  // 下面两行描述的位置一点也不动
  transform: translateY(-10rpx);
  margin-bottom: 20rpx;
}


/* 快捷入口槽位：胶囊导航自带底色 / 内边距 / 高度，这里只负责在 flex 列里占一行 */
.welcome__nav {
  flex: none;
  width: 100%;
  transition: opacity 240ms ease;
}

/* 胶囊左右沿与下方输入条对齐（加号左沿 / 键盘右沿）：
   内边距已在 ai-chat-nav 的 .ai-chat-nav__list 里统一成 48rpx，这里不再重复覆盖 */

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

/* 点「点击说话」或键盘填完点发送后立刻收掉这一行（含左右图标）：
   --flying 那条 320ms 淡出是给文字起飞配的节奏，等它走完这一行还会压在对话页底部，
   所以这里单独给一档更快的过渡（三级选择器压过 .welcome--flying 那条） */
.welcome .welcome__composer.welcome__composer--hidden {
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
}

/* 加号：44×44 圆钮，与「点击说话」胶囊 / 键盘钮同一材质（#0D0D0D30，约 19% 黑，
   压在蓝渐变上会跟背景一起走，不会像实色那样浮一层白）。
   圆底曾经画在 icon-plus.svg 里（#0D0D0D 3.61% 半透明），叠的底色一变就跟着偏色，
   现在底板交给 CSS、图标只留十字，深浅色各给一套底色 */
.welcome__composer-plus {
  display: flex;
  flex: 0 0 88rpx;
  width: 88rpx; // 44px
  height: 88rpx;
  align-items: center;
  justify-content: center;
  border-radius: 90rpx;
  background: #0d0d0d30;
}

/* 十字本体固定 20×20px（40rpx）：icon-plus.svg 自身就是 20×20，
   不再撑满 44px 圆钮，圆底只由 .welcome__composer-plus 承担 */
.welcome__composer-plus-icon {
  width: 40rpx; // 20px
  height: 40rpx;
}

/* 中间的「点击说话」胶囊：44px 高 / 圆角 45px / #0D0D0D30（约 19% 黑）
   —— 与加号、键盘钮同一材质（三块都取同一个色值，避免深浅不一）。
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
  background: #0d0d0d30;
}

/* 文案色取截图最暗像素 #5E5E5E（14px Regular，左对齐起排） */
.welcome__composer-voice-label {
  color: #ffffff;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx;
  text-align: left;
}

/* 声波芯片（实时语音）：截图 x450..526 / y352..409 → 48×36px 胶囊（圆角 18px），
   右内边距 8px、垂直居中；里面是 20×20 的 6 段声波。
   与对话页 .input-bar__wave-chip 同一套口径：实时语音没开时不铺底，
   开启后铺 #FFFFFF20（12.5% 白）做反馈，叠在「点击说话」胶囊材质之上 */
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

/* 已开启（实时语音进行中）：底 #FFFFFF20 + 蓝色声波 */
.welcome__composer-wave--active {
  background: #ffffff20;
}

.welcome__composer-wave-icon {
  width: 40rpx; // 20px，与键盘图标同尺寸（截图声波竖条间距 3.33px × 6）
  height: 40rpx;
}

/* 首页与对话输入栏保持一致，启动及运行期间均显示绿点。 */
.welcome__composer-wave--active::after,
.welcome__composer-wave--starting::after {
  position: absolute;
  top: 10rpx;
  right: 20rpx;
  z-index: 1;
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #32d74b;
  pointer-events: none;
  content: '';
}

.welcome__composer-wave--starting .welcome__composer-wave-icon {
  opacity: 0.55;
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
  background: #0d0d0d30; // 与胶囊 / 加号同一档
}

.welcome__composer-kb-icon {
  width: 40rpx; // 20px，与问答页 .input-bar__mode image 同尺寸
  height: 40rpx;
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
  background: #0d0d0d30; // 与「点击说话」胶囊同一档
}

.welcome__composer-field--with-wave {
  position: relative;
  padding-right: 120rpx;
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

/* 文本态占位「请输入内容」：压在蓝色渐变上，浅色也用纯白 #FFFFFF（原来是 #8E8E8E） */
.welcome__composer-placeholder {
  color: #ffffff;
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
  // margin-top: 16rpx; // 8px，与问答页 .chat-input__footer 的上间距一致
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
  // 深色同样在底部「加号 + 点击说话 + 键盘」这一条带铺渐变，但换成更深的一档
  // （上透明 → 底部实色 #0B6EDA）；带高与浅色一致（208rpx − 32rpx，不贴到胶囊下沿），
  // 深色底用 background-color 写，不能再走 `background` 简写，否则会把渐变一起清掉
  background-color: #0d0d0d;
  background-image: linear-gradient(180deg, rgba(11, 110, 218, 0) 0%, #0b6eda 100%);
  background-repeat: no-repeat;
  background-position: center bottom;
  background-size: 100% 176rpx;
  background-size: 100% calc(176rpx + env(safe-area-inset-bottom));
  color: #f2f3f5;

  /**
   * 深色专有的中间那枚半圆：直径 600rpx、弧顶朝上，62% 白（即 #ffffff9e）。
   * 只有深色铺，浅色不铺白底。
   *
   * 几个必要项写全：没有 `content` 伪元素根本不会生成盒子（只有颜色 / blur 是画不出来的）；
   * `fill` 是 SVG 属性，对伪元素无效，底色要用 `background-color`。
   * z-index: -1 让它压在渐变之上、输入条与提示文字之下；blur 把边缘糊开成一团柔光。
   */
  &::before {
    content: "";
    position: absolute;
    z-index: -1;
    bottom: -230rpx;
    left: 50%;
    width: 600rpx;
    height: 300rpx;
    background-color: rgba(255, 255, 255, 0.62);
    border-radius: 300rpx 300rpx 0 0;
    filter: blur(76rpx);
    transform: translateX(-50%);
    pointer-events: none;
  }

  /* 文案组反白：标语纯白、两行描述 45% 白（与引导页 gi--dark 同一口径），深底上才读得清 */
  .welcome__slogan {
    color: #ffffff;
    // 深色稿标语不动（上提只针对浅色）
    transform: none;
  }
}

/* 起飞态仍然要让位给下面的问答页：深色底不能把它盖住 */
.welcome--dark.welcome--leaving {
  background: transparent;
}

/* 起飞时深色那枚半圆也一起收掉（优先级要压过上面的 .welcome--dark::before） */
.welcome--dark.welcome--leaving::before {
  content: none;
}

/* 标题行深色稿不需要额外覆盖：字标已按主题在 script 里切图（sany-neo-light / sany-neo-dark） */

/* 输入条控件的材质在深色下换成 #FFFFFF30（半透明白，与浅色的 #0D0D0D30 对称）：
   加号圆钮也在这一组里，四块（加号 / 胶囊 / 文本框 / 键盘钮）始终同色 */
.welcome--dark .welcome__composer-plus,
.welcome--dark .welcome__composer-voice,
.welcome--dark .welcome__composer-field,
.welcome--dark .welcome__composer-kb {
  background: #ffffff30;
}

/* 文本态有内容的发送钮是实心图标，不跟着铺底板 */
.welcome--dark .welcome__composer-kb--send {
  background: transparent;
}

/* 声波芯片：深色与浅色同一口径 —— 未开启不铺底，开启后 #FFFFFF20 + 蓝色声波 */
.welcome--dark .welcome__composer-wave {
  background: transparent;
}

.welcome--dark .welcome__composer-wave--active {
  background: #ffffff20;
}

/* 「点击说话」文案：深色下压纯白 #FFFFFF（比根节点继承的 #F2F3F5 再亮一档），
   与对话页 .input-bar__hold-label 深色值对齐 */
.welcome--dark .welcome__composer-voice-label {
  color: #ffffff;
}

.welcome--dark .welcome__composer-textarea {
  color: #f2f3f5;
}

// 深色同样是纯白，与问答页 .input-bar__placeholder 口径一致
.welcome--dark .welcome__composer-placeholder {
  color: #ffffff;
}

/* 加号 / 键盘图标素材本身就是白色线条（icon-plus.svg / icon-keyboard-dark.svg）：
   浅色 / 深色都保持白色，任何主题都不做反相 */

/* 文本态发送是深色线条图标（icon-send-up.svg），深底仍按老规矩反成白线 */
.welcome--dark .welcome__composer-kb--send .welcome__composer-kb-icon {
  filter: invert(1);
}

/* 麦克风图标（icon-mic-red.svg）素材本身就是白色线条：浅色 / 深色都保持白色，
   不再压成 #0D0D0D（原来那条 brightness(0) invert(5.1%) 会把它染黑） */
.welcome__composer-kb--mic .welcome__composer-kb-icon {
  filter: none;
}

/* 主视觉的投影：浅色稿是黑 14%，深底上等于没有，加浓一档让三角浮起来 */
.welcome--dark .welcome__logo-img {
  filter: drop-shadow(0 6rpx 24rpx rgba(0, 0, 0, 0.55));
}

.welcome--dark .welcome__disclaimer-text {
  color: rgba(255, 255, 255, 0.45);
}
</style>
