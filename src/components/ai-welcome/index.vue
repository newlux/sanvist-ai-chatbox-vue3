<script setup lang="ts">
import type { PropType } from "vue";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import brandLetterA from "@/assets/img/icon-A.png";
import brandLetterI from "@/assets/img/icon-I.png";
import keyboardIcon from "@/assets/img/icon-keyboard-dark.svg";
import sendUpIcon from "@/assets/img/icon-send-up.svg";
import voiceWaveIcon from "@/assets/img/icon-voice-wave-dark.svg";
import listenLogo from "@/assets/img/listen.gif";
import saniLogo from "@/assets/img/sani-logo.gif";
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
 * 语音 / 文字两条起飞路径的区别只在 logo 的状态图：语音会先挂上 listen.gif
 * （从第 0 帧起播，父页面据此对齐扩散峰值），文字不换图，直接让常态图飞上去。
 *
 * `nav` 具名插槽：底部输入条上方的一行（首页在纯净模式关闭时塞快捷入口胶囊），
 * 不传就不占位；起飞时与标题 / 输入条一起淡出。
 */
defineOptions({ name: "AiWelcome" });

const props = defineProps({
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
  (e: "send-text", text: string): void;
}>();

const { t } = useI18n();
const { safeAreaStyle } = useSafeArea();

/**
 * listen.gif 平时不挂载，等父页面确认「要起飞了」再创建这张图。
 *
 * 动图只要挂在页面上就在自己循环，挂载那一刻播到第几帧完全不可控，
 * 父页面就没法把「扩散到最大」对齐成固定时刻。改成起飞前才新建 <img>，
 * 浏览器一定从第 0 帧开始播，于是「480ms 后扩散到最大」才是准的。
 */
const listenMounted = ref(false);
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

/** 右侧按钮图标：语音态是键盘；文本态没内容时是声波（切回语音），有内容时是发送 */
const rightIcon = computed(() => {
  if (!textMode.value) return keyboardIcon;
  return draft.value.trim() ? sendUpIcon : voiceWaveIcon;
});
const rightIsSend = computed(() => textMode.value && Boolean(draft.value.trim()));

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

function onRightTap() {
  if (!textMode.value) {
    onKeyboardTap();
    return;
  }
  if (draft.value.trim()) {
    sendDraft();
    return;
  }
  exitTextMode();
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
      <!-- 标题行：Hey,SANI 里除 A / I 两张位图外，其余字母统一吃一条线性渐变。
           渐变铺在整行容器上再 background-clip: text，子级 text 只留字形（文字颜色透明），
           这样渐变跨过 A / I 之后仍然是一条连续的 #3D21CD → #FD90C4 -->
      <view class="welcome__title">
        <text class="welcome__title-hey">Hey,</text>
        <view class="welcome__title-brand-row">
          <text class="welcome__title-brand">S</text>
          <image class="welcome__title-letter welcome__title-letter--a" :src="brandLetterA" mode="aspectFit" />
          <text class="welcome__title-brand">N</text>
          <image class="welcome__title-letter welcome__title-letter--i" :src="brandLetterI" mode="aspectFit" />
        </view>
      </view>
      <!-- 主视觉：原 306:2783 容器 134×134 / 306:2791 图 110×110，投影 0 3 9 rgba(0,0,0,.14)
           起飞时整组按父页面给的 transform 滑到对话页顶部的灵动岛位置；
           点下去先切成 listen.gif（与对话页灵动岛同一套交叉溶解），再往上走 -->
      <view class="welcome__logo">
        <view class="welcome__logo-fly" :style="logoStyle">
          <image
            class="welcome__logo-img"
            :class="{ 'welcome__logo-img--out': leaving && listenMounted }"
            :src="saniLogo"
            mode="aspectFit"
          />
          <image
            v-if="listenMounted"
            class="welcome__logo-listen"
            :src="listenLogo"
            mode="aspectFit"
            @load="onListenLoad"
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
        v-else class="welcome__composer-voice"
          ref="speakButtonRef"
        @touchstart="onSpeakPressStart" @touchmove="onSpeakPressMove"
        @touchend="clearSpeakHold" @touchcancel="clearSpeakHold"
        @mousedown="onSpeakPressStart" @mouseup="clearSpeakHold"
        @tap="onSpeakTap"
      >
        <text class="welcome__composer-voice-label">
          {{ t("welcome-tap-to-speak") }}
        </text>
      </view>
      <view
        class="welcome__composer-kb"
        :class="{ 'welcome__composer-kb--send': rightIsSend }"
        @tap="onRightTap"
      >
        <image
          class="welcome__composer-kb-icon"
          :src="rightIcon"
          mode="aspectFit"
        />
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
   设计稿 306:2801 / 306:2782：24px / Medium(500) / 行高 35px；1px = 2rpx，故 48rpx / 70rpx。
   渐变色值统一为 90deg 四色 #3D21CD → #1999FE → #C067FA → #FD90C4（各 100% 不透明）。
   渐变铺在整行容器上，再用 background-clip: text 裁到字形：
   子级 text 一律透明填充，字形由父级背景着色，因此 H / e / y / , / S / N 是同一条连续渐变，
   中间夹着的 A / I 位图不走这条背景（图片自身不透明），不需要逐字母切片或测量 */
.welcome__title {
  display: flex;
  align-items: center;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 33.33%,
    #c067fa 66.67%,
    #fd90c4 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 48rpx; // 306:2801 · 24px
  font-weight: 500; // Medium
  line-height: 70rpx; // 306:2801 · 35px
  white-space: nowrap;
  transition: opacity 240ms ease;
}

/* 行容器：S / N 文字 + A / I 位图逐个紧贴，无 gap、无 margin，全靠 flex 排布；
   按文字基线对齐后，四段的底边落在同一条基线上 */
.welcome__title-brand-row {
  display: flex;
  align-items: baseline;
}

/* 字母位图：icon-A.png 17×26、icon-I.png 7×26（素材实测尺寸，非设计稿标注）。
   画布 26px 内字母本体只占 y 4..23（20px 高），比 306:2801 的 24px 字号 cap height（≈17px）高，
   按 26px 原样挂会冒头顶 —— 显示高度收到 44rpx（22px），本体缩到 ≈17px，与 S / N 齐高；
   宽度按同一比例换算：A 17×22/26 = 14.4px → 29rpx，I 7×22/26 = 5.9px → 12rpx */
.welcome__title-letter {
  flex: none;
  height: 44rpx; // 22px
  /* 画布底部还有 1.7px 透明留白：baseline 对齐会把画布底边贴到基线上，本体因此悬空 1.7px。
     用 transform 视觉下移 3rpx（1.5px）把留白补回来，不动布局、也不引入 margin */
  transform: translateY(3rpx);
}

.welcome__title-letter--a {
  width: 29rpx; // 14.4px
}

.welcome__title-letter--i {
  width: 12rpx; // 5.9px
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

/* 点「点击说话」后常态图淡出，让给 listen.gif */
.welcome__logo-img--out {
  opacity: 0;
  transition: opacity 360ms ease;
}

/* listen.gif 是 500×500 画布、图案只占中间 201×172，aspectFit 后图案会小一半多；
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
  padding: 16rpx 40rpx; // 上下 8px / 左右 20px
  box-sizing: border-box;
  transition: opacity 240ms ease;
}

/* 加号：icon-plus.svg 自带 44×44 圆底（#0D0D0D 3.61%）与十字 */
.welcome__composer-plus {
  flex: 0 0 88rpx;
  width: 88rpx; // 44px
  height: 88rpx;
}

/* 中间的「点击说话」胶囊：44px 高 / 圆角 45px / #0D0D0D 3.61% */
.welcome__composer-voice {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 88rpx;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 90rpx;
  background: rgba(13, 13, 13, 0.0361);
}

.welcome__composer-voice-label {
  color: #0d0d0d; // 与问答页 .input-bar__hold-label 同色
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx;
  text-align: center;
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

/* 文本态有内容：右侧换成对话页那颗实心发送（不再套灰圆底） */
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
   与对话页 .ai-page--dark 同一套底色 #1A1A1A（不是纯黑），
   只换底色与材质，间距 / 字号 / 圆角与浅色稿一致；
   初始页原来只有一套浅色样式，深色宿主下会先闪一整屏 #FAFAFA 再切到深色对话页。 */
.welcome--dark {
  background: #1a1a1a;
  color: #f2f3f5;
}

/* 起飞态仍然要让位给下面的问答页：深色底不能把它盖住 */
.welcome--dark.welcome--leaving {
  background: transparent;
}

/* 深色下整行仍是同一条渐变，只把四色换成深色稿那一组（1193:1848，
   与 report-insight 的重播角标同一套）：浅色稿的起始色 #3D21CD 打在 #1A1A1A 上第一段几乎糊成一片 */
.welcome--dark .welcome__title {
  background-image: linear-gradient(
    90deg,
    #a7aaf9 0%,
    #75b6fa 33.33%,
    #a8a9f9 66.67%,
    #f08fc2 100%
  );
}

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

/* 主视觉的投影：浅色稿是黑 14%，深底上等于没有，加浓一档让三角浮起来 */
.welcome--dark .welcome__logo-img {
  filter: drop-shadow(0 6rpx 24rpx rgba(0, 0, 0, 0.55));
}

.welcome--dark .welcome__disclaimer-text {
  color: rgba(255, 255, 255, 0.45);
}
</style>
