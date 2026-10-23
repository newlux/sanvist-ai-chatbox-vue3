<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import backIcon from "@/assets/img/nav-arrow-left.svg";
import stepIcon from "@/assets/img/qrcode-step-form.svg";
import introVideo from "@/assets/video/qrcode-intro.mp4";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { encodeQrCode } from "@/utils/qrcode";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 扫码下载页（pages/qrcode/index）。
 *
 * 视觉：Ardot 865:1325「二维码页面-方案1」375×812。
 *   标题 → 副标题 → 白蓝渐变卡片（彩色二维码 + 说明）→ 登记领礼品提示。
 *
 * 开场：先用一段 4s 的 SANI 三角标动画（720×1280）铺满全屏。播完后视频最后一帧的二维码
 *   朝页面二维码缩小落位（480ms），同一时间页面内容浮上来，终点两码逐像素重合，
 *   观感是「视频里的二维码变成了页面上的二维码」，不跳不硬切。视频兜底见 INTRO_* 常量。
 *
 * 入口：工作流把 `outputs.answer` 置成 `<QRCODE>文案</QRCODE>`（老写法是纯占位文本 "QRCODE"）时，
 * useChatSend 会跳到本页；文案留在聊天气泡里展示，二维码内容取自路由参数 `content`
 * （来自 message_end.metadata.qrcode / qrcode_content）。
 * 没带参数（例如直接打开本页）时扫码指向 App 下载页，与本项目分享面板复用同一地址。
 * 渲染：本地把文本编码成二维码矩阵再拼成 SVG，不依赖第三方库和网络图片。
 */

defineOptions({ name: "QrCodePage" });

const { t } = useI18n();
const { safeAreaStyle } = useSafeArea();
const logger = createLogger("qrcode-page");

/** 二维码四周的静默区（模块数），少于 4 个很多扫码器识别不到 */
const QUIET_ZONE = 4;
/** 默认扫码内容：三一 App 下载页（与 useChatShare 的「复制链接」同一地址） */
const DEFAULT_QR_CONTENT = "https://portal.sanygroup.com/appDownload/";
/** 码点渐变（设计稿 865:1772）：从左上到右下，0% → 48.72% → 76% → 100% */
const QR_GRADIENT_STOPS = [
  { offset: "0", color: "#3D21CD" },
  { offset: "0.4872", color: "#1999FE" },
  { offset: "0.76", color: "#C067FA" },
  { offset: "1", color: "#FD90C4" },
];

const content = ref(DEFAULT_QR_CONTENT);

onLoad((options) => {
  // uni 已经把路由 query 解码过一次，这里不再 decodeURIComponent（内容本身可能带 %）
  const next = String(options?.content ?? "").trim();
  if (next) content.value = next;
});

/** 视频淡完后再等一点才卸载视频层，避免末尾黑帧闪一下（交叉淡入本身是 720ms，写在样式里） */
const INTRO_UNMOUNT_DELAY_MS = 900;
/** 自动播放被拦（一直没触发 play / timeupdate）时的兜底：直接进页面，别停在空屏 */
const INTRO_AUTOPLAY_GUARD_MS = 1600;
/** 开场视频的组件 id（VideoContext 用） */
const INTRO_VIDEO_ID = "qrcode-intro-video";

/** 视频层是否还在 DOM 里 */
const showIntro = ref(true);
/** 视频是否还在播；置 false 即开始「缩小落位 + 淡出」 */
const introPlaying = ref(true);
/** 视频出画后再显示，避免首帧没解码时露出播放器的黑底 */
const introVideoReady = ref(false);
/** 二维码内容是否已浮现 */
const pageVisible = ref(false);

let introUnmountTimer: ReturnType<typeof setTimeout> | null = null;
let introGuardTimer: ReturnType<typeof setTimeout> | null = null;
let introStarted = false;

/** 视频播完 / 出错 / 自动播放被拦：统一走这里，视频缩小落位的同时页面浮上来 */
function revealPage() {
  if (!introPlaying.value) return;
  introPlaying.value = false;
  pageVisible.value = true;
  introStarted = true;
  if (introGuardTimer) {
    clearTimeout(introGuardTimer);
    introGuardTimer = null;
  }
  if (introUnmountTimer) clearTimeout(introUnmountTimer);
  introUnmountTimer = setTimeout(() => {
    introUnmountTimer = null;
    showIntro.value = false;
  }, INTRO_UNMOUNT_DELAY_MS);
}

function onIntroPlay() {
  introStarted = true;
  introVideoReady.value = true;
}

function onIntroEnded() {
  revealPage();
}

/** 视频解码失败 / 资源 404：不要卡在视频层，直接展示二维码 */
function onIntroError(event: unknown) {
  logger.warn("intro video failed, reveal qrcode page directly", event);
  revealPage();
}

onMounted(() => {
  // uni 的 video 组件没有把 muted 透传到原生 <video>，iOS 上会被自动播放策略直接拦掉；
  // 这里（H5 形态）直接给原生节点补上 muted，再兜一次显式 play()
  try {
    const el = document.querySelector<HTMLVideoElement>(`#${INTRO_VIDEO_ID} video`);
    if (el) el.muted = true;
  }
  catch (error) {
    logger.debug("intro video mute failed", error);
  }

  // 个别 WebView 不认 autoplay 属性，只认显式 play()：补一次，失败就走下面的兜底
  setTimeout(() => {
    if (introStarted || !showIntro.value) return;
    try {
      uni.createVideoContext(INTRO_VIDEO_ID).play?.();
    }
    catch (error) {
      logger.debug("intro video play() failed", error);
    }
  }, 150);

  introGuardTimer = setTimeout(() => {
    introGuardTimer = null;
    if (introStarted) return;
    logger.warn("intro video autoplay blocked, reveal qrcode page directly");
    revealPage();
  }, INTRO_AUTOPLAY_GUARD_MS);
});

onBeforeUnmount(() => {
  if (introGuardTimer) clearTimeout(introGuardTimer);
  if (introUnmountTimer) clearTimeout(introUnmountTimer);
});

/**
 * 把二维码矩阵拼成单条 SVG path，再套一层渐变填充（设计稿的二维码是彩色码点，不是黑码）。
 * failed 表示内容超出编码容量。
 */
const qrCode = computed(() => {
  if (!content.value) return { svg: "", failed: false };
  try {
    const { size, modules } = encodeQrCode(content.value);
    const total = size + QUIET_ZONE * 2;
    let path = "";
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (modules[row][col]) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    const stops = QR_GRADIENT_STOPS
      .map(stop => `<stop offset="${stop.offset}" stop-color="${stop.color}"/>`)
      .join("");
    // 渐变用 userSpaceOnUse 铺满整个码区（含静默区），方向与设计稿一致：左上 → 右下
    // 不铺白色底：设计稿的码点下面透出的是卡片自身的渐变
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><defs><linearGradient id="qrcode-color" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${total}" y2="${total}">${stops}</linearGradient></defs><path d="${path}" fill="url(#qrcode-color)"/></svg>`;
    return { svg, failed: false };
  }
  catch (error) {
    logger.error("failed to encode qrcode content", error);
    return { svg: "", failed: true };
  }
});

const qrSvg = computed(() => qrCode.value.svg);

function onBack() {
  backFromScene();
}
</script>

<template>
  <!-- 页面背景 865:1327：竖向渐变 #E6F1FF → #F5F9FF，铺满 375×812 -->
  <view class="qrcode-page" :style="safeAreaStyle">
    <!-- 二维码内容层：视频播完后由下方淡入上浮，与视频层的淡出同时进行，形成交叉淡入 -->
    <view class="qrcode-page__stage" :class="{ 'qrcode-page__stage--in': pageVisible }">
      <!-- 设计稿没有返回位，宿主 WebView 里必须留一个可达的返回热区，浮在标题上方空白区 -->
      <view class="qrcode-page__back" @tap="onBack">
        <image class="qrcode-page__back-icon" :src="backIcon" />
      </view>

      <view class="qrcode-page__main">
        <!-- 标题区：标题 865:1775 + 副标题 865:1332 -->
        <view class="qrcode-page__head">
          <!-- 标题：y=139，24px / 行高 35px / Bold / #0D0D0D，居中 -->
          <text class="qrcode-page__title">扫码下载 SanVIST App</text>
          <!-- 副标题：y=181，16px / 行高 23px / Regular / #5E5E5E，居中 -->
          <text class="qrcode-page__subtitle">很高兴认识你！要不要把我也装进手机里？</text>
        </view>

        <view class="qrcode-page__body">
          <!-- 卡片 865:1330：x=24 y=221，327×312，圆角 12，2px 白描边，渐变 #EFF9FF → #FFFFFF -->
          <view class="qrcode-card">
            <!-- 二维码 865:1337：卡片内距顶 40px，192×192，彩色渐变码点。
                 二维码是本地编码后拼出来的 SVG 字符串，只能走 v-html -->
            <!-- eslint-disable-next-line vue/no-v-text-v-html-on-component -->
            <view v-if="qrSvg" class="qrcode-card__code" v-html="qrSvg" />
            <view v-else class="qrcode-card__failed">
              <text class="qrcode-card__failed-text">{{ t("qrcode-failed") }}</text>
            </view>
            <!-- 卡片说明 865:1774：二维码下方 35px，14px / 行高 21px / Regular / #0D0D0D -->
            <text class="qrcode-card__tip">下载并填写信息，即可体验已开放能力</text>
          </view>

          <!-- 登记领礼品 865:1333 / 865:1335 / 865:1773：卡片下方 30px，徽标在左、两行文案在右 -->
          <view class="qrcode-page__note">
            <!-- 徽标底 865:1334：42×42，圆角 12，1px 白描边，渐变同卡片 -->
            <view class="qrcode-page__note-badge">
              <!-- 徽标图标 865:1336：20×17.5 / #0D0D0D -->
              <image class="qrcode-page__note-icon" :src="stepIcon" />
            </view>
            <!-- 两行文案 865:1773：14px / 行高 21px / Regular / #5D5D5D，与徽标顶对齐 -->
            <view class="qrcode-page__note-text">
              <text class="qrcode-page__note-line">完成信息登记，</text>
              <text class="qrcode-page__note-line">还可向现场工作人员领取一份小礼品。</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 开场视频层：4s 的 SANI 三角标动画，cover 铺满全屏；播完淡出并卸载 -->
    <view
      v-if="showIntro"
      class="qrcode-page__intro"
      :class="{ 'qrcode-page__intro--out': !introPlaying }"
    >
      <video
        :id="INTRO_VIDEO_ID"
        class="qrcode-page__intro-video"
        :class="{ 'qrcode-page__intro-video--ready': introVideoReady }"
        :src="introVideo"
        :autoplay="true"
        :muted="true"
        :controls="false"
        :loop="false"
        object-fit="cover"
        :show-center-play-btn="false"
        :show-fullscreen-btn="false"
        :show-play-btn="false"
        :show-progress="false"
        :enable-progress-gesture="false"
        @play="onIntroPlay"
        @ended="onIntroEnded"
        @error="onIntroError"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 整页：865:1327 的 375×812 渐变底 */
.qrcode-page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-image: linear-gradient(180deg, #e6f1ff 0%, #f5f9ff 100%);
}

/* 二维码内容层：与视频层同一坐标系，视频播完时淡入上浮（720ms，与视频淡出同步） */
.qrcode-page__stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  transform: translateY(24rpx); // 12px
  // 位移跟视频落位同步（480ms），保证落位那一刻页面二维码已经在最终位置；
  // 透明度仍然慢一点（720ms），内容是被「揭开」的，不是硬切进来
  transition: opacity 720ms ease, transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.qrcode-page__stage--in {
  opacity: 1;
  transform: translateY(0);
}

/* 文字比二维码慢一拍浮现：卡片跟着内容层一起进来（时序不变），
   标题 / 副标题 / 卡片说明 / 登记文案各自再晚 200~440ms 淡入，读起来是「码先到、字后到」 */
.qrcode-page__title,
.qrcode-page__subtitle,
.qrcode-card__tip,
.qrcode-page__note {
  opacity: 0;
  transition: opacity 600ms ease;
}

.qrcode-page__stage--in .qrcode-page__title {
  opacity: 1;
  transition-delay: 200ms;
}

.qrcode-page__stage--in .qrcode-page__subtitle {
  opacity: 1;
  transition-delay: 280ms;
}

.qrcode-page__stage--in .qrcode-card__tip {
  opacity: 1;
  transition-delay: 360ms;
}

.qrcode-page__stage--in .qrcode-page__note {
  opacity: 1;
  transition-delay: 440ms;
}

/* 开场视频层：盖在内容层之上，播完「缩小落位 + 淡出」后卸载。
   淡出（420ms）比缩小（480ms）早收一点：视频是不透明的矩形，缩小后它的边框会盖住
   正在淡入的页面内容，尽早淡到 0 才不会露出一个方框 */
.qrcode-page__intro {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
  // 与页面同一底色，视频按 cover 铺满；淡出过程里不会透出白/黑的底
  background-image: linear-gradient(180deg, #e6f1ff 0%, #f5f9ff 100%);
  opacity: 1;
  transition: opacity 420ms ease;
}

.qrcode-page__intro--out {
  opacity: 0;
}

/* 视频 720×1280（9:16）铺满竖屏：cover 裁掉左右少量画面，画面始终居中。
   播放器首帧解码前是空的/黑的，所以先不显示，等 play 事件再淡入。
   收尾时最后一帧的二维码朝页面二维码「落」下去：缩小 + 上移同时进行，终点与页面二维码
   逐像素重合，页面内容在同一时间浮上来（demo 里就是这个观感）。参数实测于 375×812：
   - 末帧码区（暗色模块区）238×238，码区中心在视口的 50% / 49.3%
   - 页面二维码是 240 的 SVG，去掉四周 4 个模块静默区后码区 188×188，中心在 y=380.6
   所以缩到 188 / 238 ≈ 0.79、再上移 20px */
.qrcode-page__intro-video {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  // 缩放锚点 = 末帧码区中心，缩放时中心不动，位移量才好算
  transform: translateY(0) scale(1);
  transform-origin: 50% 49.3%;
  transition: opacity 240ms ease, transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.qrcode-page__intro-video--ready {
  opacity: 1;
}

.qrcode-page__intro--out .qrcode-page__intro-video {
  transform: translateY(-40rpx) scale(0.79);
}

/* 返回热区：设计稿无此元素，尺寸取自原有导航习惯（88rpx 点击区 + 36rpx 图标） */
.qrcode-page__back {
  position: absolute;
  top: calc(var(--safe-top-px, 0px) + 8rpx);
  left: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
}

.qrcode-page__back-icon {
  width: 36rpx;
  height: 36rpx;
}

/* 主内容：标题距屏顶 139px（设计稿 y=139），左右各留 24px 给卡片 */
.qrcode-page__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  padding: 278rpx 48rpx 0; // 139px / 24px
  gap: 34rpx; // 副标题底 → 卡片顶 17px
}

/* 标题 + 副标题：两者间距 7px */
.qrcode-page__head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx; // 7px
}

/* 865:1775：24px / 行高 35px / Bold / #0D0D0D */
.qrcode-page__title {
  color: #0d0d0d;
  font-family: "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 48rpx; // 24px
  font-weight: 700;
  line-height: 70rpx; // 35px
  text-align: center;
  white-space: nowrap;
}

/* 865:1332：16px / 行高 23px / Regular / #5E5E5E */
.qrcode-page__subtitle {
  color: #5e5e5e;
  font-family: "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 32rpx; // 16px
  font-weight: 400;
  line-height: 46rpx; // 23px
  text-align: center;
  white-space: nowrap;
}

/* 卡片与登记行的纵向节奏：卡片底 → 提示顶 30px */
.qrcode-page__body {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 60rpx; // 30px
}

/* 865:1330：卡片 327 宽、圆角 12、2px 白描边、渐变 #EFF9FF → #FFFFFF，无投影。
   二维码按「接住视频末帧」放大到 192 → 240px，卡片高度随之由 312 长到 360（其余间距全按设计稿） */
.qrcode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  // 上下 padding 已减去 2px 描边占位，保证描边内侧到二维码仍是 40px、卡片内底部仍是 24px
  padding: 76rpx 0 44rpx; // 40px − 2px / 24px − 2px
  border: 2px solid #ffffff;
  border-radius: 24rpx; // 12px
  background-image: linear-gradient(180deg, #eff9ff 0%, #ffffff 100%);
  gap: 70rpx; // 二维码底 → 说明文字顶 35px
  // 视频末帧的二维码是「缩一下落位」的，卡片也带同样方向的缩放；
  // 时长与视频落位（480ms）对齐，落位那一刻卡片的码刚好也是 240，两个码完全重合
  transform: scale(0.94);
  transition: transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.qrcode-page__stage--in .qrcode-card {
  transform: scale(1);
}

/* 865:1337：原稿 192×192，这里放大到 240×240（码区 188×188），
   与视频最后一帧缩到这个尺寸后的落点对齐 */
.qrcode-card__code {
  width: 480rpx; // 240px
  height: 480rpx;
}

/* 编码失败时的兜底，占位与二维码同尺寸，避免卡片高度跳动 */
.qrcode-card__failed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 480rpx; // 240px
  height: 480rpx;
}

.qrcode-card__failed-text {
  color: #5e5e5e;
  font-size: 28rpx;
  line-height: 42rpx;
}

/* 865:1774：14px / 行高 21px / Regular / #0D0D0D */
.qrcode-card__tip {
  color: #0d0d0d;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 42rpx; // 21px
  text-align: center;
  white-space: nowrap;
}

/* 865:1333 + 865:1773：徽标距卡片左边缘 18px，徽标与文案间距 10px */
.qrcode-page__note {
  display: flex;
  align-items: flex-start;
  box-sizing: border-box;
  width: 100%;
  padding-left: 36rpx; // 18px
  gap: 20rpx; // 10px
}

/* 865:1334：42×42，圆角 12，1px 白描边，渐变同卡片 */
.qrcode-page__note-badge {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 84rpx; // 42px
  height: 84rpx; // 42px
  border: 1px solid #ffffff;
  border-radius: 24rpx; // 12px
  background-image: linear-gradient(180deg, #eff9ff 0%, #ffffff 100%);
}

/* 865:1336：20×17.5 */
.qrcode-page__note-icon {
  width: 40rpx; // 20px
  height: 35rpx; // 17.5px
}

/* 865:1773：两行 14px / 行高 21px / Regular / #5D5D5D，与徽标顶部对齐 */
.qrcode-page__note-text {
  display: flex;
  flex-direction: column;
}

.qrcode-page__note-line {
  color: #5d5d5d;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 42rpx; // 21px
  white-space: nowrap;
}
</style>
