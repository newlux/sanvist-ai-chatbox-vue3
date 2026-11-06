<script setup lang="ts">
import type { PropType } from "vue";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import listenLogo from "@/assets/img/listen.gif";
import saniLogo from "@/assets/img/sani-logo.gif";
import { useSafeArea } from "@/hooks/useSafeArea";

/**
 * 初始页（首页 welcome 态）：中间 SANI 图标 +「Hey,SANI」，底部一条静态输入栏。
 *
 * 原来的游客 / 会员两套欢迎页（渐变标语、三行说明、底部光效、身份选择气泡等）
 * 全部停用；组件文件 visitor.vue、member.vue 仍保留在同一目录，需要恢复时换回引用即可。
 *
 * 点「点击说话」只抛 start-chat，飞出动画由父页面驱动：
 * 父页面把 logo 的目标位移算好塞进 logoStyle，本组件只负责把 transition 跑完。
 */
defineOptions({ name: "AiWelcome" });

const props = defineProps({
  /** 起飞态：底色让位给下面的对话页，标题 / 输入条淡出，logo 按 logoStyle 滑向顶部 */
  leaving: { type: Boolean, default: false },
  /** 已到顶：logo 淡出，由对话页自己的灵动岛图标接上，避免最后 1-2px 的跳变被看见 */
  landed: { type: Boolean, default: false },
  /** logo 的目标 transform（由父页面按灵动岛实际坐标算出） */
  logoStyle: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
});

const emit = defineEmits<{ (e: "start-chat"): void }>();

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

function fireStart() {
  if (startFired) return;
  startFired = true;
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  emit("start-chat");
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

onBeforeUnmount(() => {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
});
</script>

<template>
  <view
    class="welcome"
    :class="{ 'welcome--leaving': leaving, 'welcome--landed': landed }"
    :style="safeAreaStyle"
  >
    <view class="welcome__hero">
      <!-- 标题行：Hey, 纯色 + SANI 渐变（原 306:2801 / 306:2782 的浅色稿） -->
      <view class="welcome__title">
        <text class="welcome__title-hey">Hey,</text>
        <text class="welcome__title-brand">SANI</text>
      </view>
      <!-- 主视觉：原 306:2783 容器 134×134 / 306:2791 图 110×110，投影 0 3 9 rgba(0,0,0,.14)
           起飞时整组按父页面给的 transform 滑到对话页顶部的灵动岛位置；
           点下去先切成 listen.gif（与对话页灵动岛同一套交叉溶解），再往上走 -->
      <view class="welcome__logo">
        <view class="welcome__logo-fly" :style="logoStyle">
          <image
            class="welcome__logo-img"
            :class="{ 'welcome__logo-img--out': leaving }"
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

    <!-- 底部输入条（Ardot 1204:337 Toolbar）：加号 44×44 + 点击说话 219×44 + 键盘 44×44，gap 10 -->
    <view class="welcome__composer">
      <image
        class="welcome__composer-plus"
        src="@/assets/img/icon-plus.svg"
        mode="aspectFit"
      />
      <view class="welcome__composer-voice" @tap="onSpeakTap">
        <text class="welcome__composer-voice-label">
          {{ t("welcome-tap-to-speak") }}
        </text>
      </view>
      <view class="welcome__composer-kb">
        <image
          class="welcome__composer-kb-icon"
          src="@/assets/img/icon-keyboard-dark.svg"
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

.welcome__title {
  display: flex;
  align-items: center;
  color: #0d0d0d;
  font-size: 48rpx; // 24px
  font-weight: 500;
  line-height: 70rpx; // 35px
  white-space: nowrap;
  transition: opacity 240ms ease;
}

/* 306:2782：SANI 渐变文字（#3D21CD → #1999FE → #C067FA → #FD90C4） */
.welcome__title-brand {
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
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
</style>
