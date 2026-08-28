<script setup lang="ts">
import type { ListenBroadcastConfig, ListenBroadcastStyle } from "@/api/listen-broadcast/types";
import { computed, onMounted, ref } from "vue";
import { getListenBroadcastConfig, saveListenBroadcastPreference } from "@/api/listen-broadcast";
import arrowLeftIcon from "@/assets/img/voice-assistant/voice-arrow-left.svg";
import arrowRightIcon from "@/assets/img/voice-assistant/voice-arrow-right.svg";
import bubbleGlowIcon from "@/assets/img/voice-assistant/voice-bubble-glow.svg";
import capsuleGlowOff from "@/assets/img/voice-assistant/voice-capsule-glow-off.png";
import capsuleGlowOn from "@/assets/img/voice-assistant/voice-capsule-glow-on.png";
import checkOffIcon from "@/assets/img/voice-assistant/voice-check-off.svg";
import checkOnIcon from "@/assets/img/voice-assistant/voice-check-on.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-close.svg";
import { useReportStyle } from "@/hooks/useReportStyle";
import { createLogger } from "@/utils/logger";

const props = defineProps<{
  voiceCode: string;
}>();

const emit = defineEmits<{
  confirm: [style: ListenBroadcastStyle, moduleCodes: string[]];
  close: [];
}>();

const logger = createLogger("report-style-selector");
const { saveReportStyle } = useReportStyle();
const config = ref<ListenBroadcastConfig | null>(null);
const loading = ref(true);
const submitting = ref(false);
const styleIndex = ref(0);
const checkedIds = ref<string[]>([]);
const selectionHint = ref("");

const styles = computed(() => config.value?.styles || []);
const modules = computed(() => config.value?.modules || []);
const currentStyle = computed(() => styles.value[styleIndex.value]);
const canConfirm = computed(() => Boolean(currentStyle.value && modules.value.length && !submitting.value));

function resetChecked() {
  const defaultModules = currentStyle.value?.defaultModules || [];
  const availableModules = new Set(modules.value.map(item => item.code));
  checkedIds.value = defaultModules.filter(code => availableModules.has(code));
}

function toggleModule(code: string) {
  if (loading.value || submitting.value || !modules.value.some(item => item.code === code)) return;
  selectionHint.value = "";
  if (checkedIds.value.includes(code)) {
    checkedIds.value = checkedIds.value.filter(item => item !== code);
  }
  else {
    checkedIds.value = [...checkedIds.value, code];
  }
}

function prevStyle() {
  if (loading.value || submitting.value || styles.value.length < 2) return;
  styleIndex.value = (styleIndex.value - 1 + styles.value.length) % styles.value.length;
  resetChecked();
}

function nextStyle() {
  if (loading.value || submitting.value || styles.value.length < 2) return;
  styleIndex.value = (styleIndex.value + 1) % styles.value.length;
  resetChecked();
}

async function confirmStyle() {
  const style = currentStyle.value;
  if (!style || submitting.value) return;
  if (!props.voiceCode) {
    selectionHint.value = "音色信息缺失，请返回重新选择";
    return;
  }
  if (!checkedIds.value.length) {
    selectionHint.value = "请至少选择一项汇报内容";
    return;
  }
  selectionHint.value = "";
  submitting.value = true;
  try {
    await saveListenBroadcastPreference({
      voiceCode: props.voiceCode,
      styleCode: style.code,
      checkedModules: checkedIds.value,
    });
    saveReportStyle(style.code, checkedIds.value);
    emit("confirm", style, checkedIds.value);
  } catch (error) {
    logger.error("failed to save listen broadcast preference", error);
    selectionHint.value = "保存失败，请稍后重试";
  } finally {
    submitting.value = false;
  }
}

async function loadConfig() {
  loading.value = true;
  try {
    config.value = await getListenBroadcastConfig();
    styleIndex.value = 0;
    resetChecked();
  } catch (error) {
    logger.error("failed to load listen broadcast config", error);
    config.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadConfig();
});
</script>

<template>
  <view class="report-style-selector">
    <!-- ② 顶部导航 Top Nav(940:136)：关闭 + 工作胶囊（不与 Home 重名） -->
    <view class="report-style-selector__topbar">
      <view class="report-style-selector__close" @tap="emit('close')">
        <image class="report-style-selector__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
      <view class="report-style-selector__working">
        <view class="report-style-selector__working-inner">
          <text class="report-style-selector__dot" />
          <text class="report-style-selector__dot" />
          <text class="report-style-selector__working-text">
            Noii 等你选..
          </text>
        </view>
      </view>
      <view class="report-style-selector__topbar-space" />
    </view>

    <!-- ③ 页面标题(940:131) -->
    <text class="report-style-selector__title">
      请选择汇报内容
    </text>

    <!-- ④ 汇报时间行(940:76) -->
    <view class="report-style-selector__time-row">
      <text class="report-style-selector__time-text">
        汇报时间：北京时间 08:00
      </text>
    </view>

    <!-- ⑤ 主体光晕 Bubble(1004:72)：风格名 + 说明 + 左右切换 -->
    <view class="report-style-selector__stage">
      <!-- 左切换箭头(940:192 24×24px 图) -->
      <image
        class="report-style-selector__switch"
        :class="{ 'report-style-selector__switch--disabled': loading || styles.length < 2 }"
        :src="arrowLeftIcon"
        mode="aspectFit"
        @tap="prevStyle"
      />
      <!-- 外层渐变描边(1004:69 主风格红色光晕)：纵向线性渐变 #F9FDFF→#FFFFFF→#FFEBEB -->
      <view class="report-style-selector__bubble">
        <!-- 内层白底 + 径向光晕(1004:72 设计稿矢量) -->
        <image class="report-style-selector__bubble-glow" :src="bubbleGlowIcon" mode="aspectFill" />
        <template v-if="loading">
          <view class="report-style-selector__skeleton report-style-selector__skeleton--style-label" />
          <view class="report-style-selector__skeleton report-style-selector__skeleton--style-name" />
          <view class="report-style-selector__skeleton report-style-selector__skeleton--dots" />
        </template>
        <template v-else>
          <text class="report-style-selector__style-label">
            汇报风格
          </text>
          <text class="report-style-selector__style-name">
            {{ currentStyle?.name || "" }}
          </text>
          <!-- 分页圆点(940:182 8×6 当前 / 940:183 6×6) -->
          <view class="report-style-selector__dots">
            <text
              v-for="(_, index) in styles"
              :key="`style-dot-${index}`"
              class="report-style-selector__dot"
              :class="{ 'report-style-selector__dot--active': index === styleIndex }"
            />
          </view>
        </template>
      </view>
      <!-- 右切换箭头(940:134 24×24px 图) -->
      <image
        class="report-style-selector__switch report-style-selector__switch--right"
        :class="{ 'report-style-selector__switch--disabled': loading || styles.length < 2 }"
        :src="arrowRightIcon"
        mode="aspectFit"
        @tap="nextStyle"
      />
    </view>

    <!-- ⑥ 权限说明(940:154) -->
    <text class="report-style-selector__permission-hint">
      你的权限可以看到以下数据
    </text>

    <!-- ⑦ 权限数据胶囊(1004:28/29/42, 1024:21)：扇形排布 -->
    <view class="report-style-selector__permission-stage">
      <template v-if="loading">
        <view
          v-for="index in 3"
          :key="`module-skeleton-${index}`"
          class="report-style-selector__capsule report-style-selector__capsule--skeleton"
          :class="`report-style-selector__capsule--${index}`"
        />
      </template>
      <template v-else>
        <view
          v-for="(module, index) in modules"
          :key="module.code"
          class="report-style-selector__capsule"
          :class="`report-style-selector__capsule--${index + 1}`"
          @tap="toggleModule(module.code)"
        >
          <!-- 胶囊底图：选中=设计稿导出粉光玻璃(1004:20)；未选=纯白玻璃(1024:25) -->
          <image
            class="report-style-selector__capsule-glow"
            :src="checkedIds.includes(module.code) ? capsuleGlowOn : capsuleGlowOff"
            mode="aspectFill"
          />
          <image
            class="report-style-selector__capsule-check"
            :src="checkedIds.includes(module.code) ? checkOnIcon : checkOffIcon"
            mode="aspectFit"
          />
          <text class="report-style-selector__capsule-text">
            {{ module.name }}
          </text>
        </view>
      </template>
    </view>

    <!-- ⑧ CTA 按钮(940:132) -->
    <text v-if="selectionHint" class="report-style-selector__selection-hint">
      {{ selectionHint }}
    </text>
    <view
      class="report-style-selector__button"
      :class="{ 'report-style-selector__button--disabled': !canConfirm }"
      @tap="canConfirm && confirmStyle()"
    >
      <text>{{ loading ? "加载中" : submitting ? "保存中" : "选择" }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* —— ① 根容器(940:130 画布 375×812，白底，flex 纵向流，内容居中) ——
   普通文档流（非 fixed 覆盖层），由外层 subagent-page flex 撑满；
   relative 仅为内部 absolute 子元素提供定位参照。顶部安全区由外层 statusbar 占位统一负责 */
.report-style-selector {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  color: #1a1a1a;
  background: #fff;
}

/* —— ② 顶部导航 Top Nav(940:136 375×50px)：关闭居左 + 工作胶囊居中，右侧等宽占位保持胶囊居中 —— */
.report-style-selector__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  width: 100%;
  height: 100rpx;
  padding: 0 40rpx;
  flex-shrink: 0;
}

.report-style-selector__close,
.report-style-selector__topbar-space {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

/* 关闭 × (980:204 24×24px) */
.report-style-selector__close-icon {
  display: block;
  width: 48rpx;
  height: 48rpx;
}

/* 工作胶囊(940:143)：双层，外层渐变描边 2rpx + 内层纯白；
   fill #FFFFFF(0.9)，stroke 线性渐变 135° #FF6B6B→#C8201E(15%)→#FFD6D1(40%)；
   box-shadow(px)：0 2px 8px rgba(0,0,0,0.08) */
.report-style-selector__working {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx;
  padding: 2rpx;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #ff6b6b 0%, #c8201e 15%, #ffd6d1 40%, #ffd6d1 100%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

.report-style-selector__working-inner {
  display: flex;
  align-items: center;
  gap: 12rpx;
  box-sizing: border-box;
  height: 100%;
  padding: 0 28rpx;
  border-radius: 34rpx;
  background: #fff;
}

.report-style-selector__working .report-style-selector__dot {
  width: 12rpx;
  height: 12rpx;
  background: #c8201e;
  border-radius: 50%;
  flex-shrink: 0;
}

.report-style-selector__working-text {
  color: #1a1a1a;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 32rpx;
}

/* —— ③ 页面标题(940:131)：17px=34rpx，Inter Medium，#1A1A1A，CENTER/TOP ——
   与导航底(90)间距 gap=122-90=32px=64rpx */
.report-style-selector__title {
  display: block;
  width: 100%;
  margin-top: 64rpx;
  color: #1a1a1a;
  font-size: 34rpx;
  font-weight: 500;
  line-height: 42rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ④ 汇报时间行(940:76)：13px=26rpx，Inter Regular，#999999 ——
   与标题底(143)间距 gap=157-143=14px=28rpx */
.report-style-selector__time-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin-top: 28rpx;
  flex-shrink: 0;
}

.report-style-selector__time-text {
  color: #999999;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 32rpx;
}

/* —— ⑤ 主体光晕 Bubble(1004:72 196×196px)：与时间行底(173)间距 gap=186-173=13px=26rpx —— */
.report-style-selector__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 400rpx;
  margin-top: 26rpx;
  flex-shrink: 0;
}

/* 外层椭圆(1004:69, 196×196px=392×392rpx)：白底(0.9) + 渐变描边 + 内外阴影；
   stroke 线性渐变(垂直 [[0,1,0],[-1,0,1]]) #F9FDFF→#FFFFFF(49%)→#FFEBEB；
   box-shadow(px)：0 5px 20px 2px rgba(166,166,166,0.25)  drop；
                    inset 13px 19px 31px rgba(209,209,209,0.25)  inner */
.report-style-selector__bubble {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 392rpx;
  height: 392rpx;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(180deg, #f9fdff 0%, #ffffff 49%, #ffebeb 100%);
  box-shadow:
    0 5px 20px 2px rgb(166 166 166 / 25%),
    inset 13px 19px 31px rgb(209 209 209 / 25%);
}

/* 内层径向光晕：直接用设计稿矢量(1004:72)，铺满并裁成圆形 */
.report-style-selector__bubble-glow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

@keyframes report-style-selector-skeleton-pulse {
  0%, 100% { opacity: 0.42; }
  50% { opacity: 0.9; }
}

.report-style-selector__skeleton {
  position: relative;
  z-index: 1;
  background: rgb(89 67 66 / 14%);
  border-radius: 999rpx;
  animation: report-style-selector-skeleton-pulse 1.2s ease-in-out infinite;
}

.report-style-selector__skeleton--style-label {
  width: 112rpx;
  height: 28rpx;
}

.report-style-selector__skeleton--style-name {
  width: 210rpx;
  height: 60rpx;
  margin-top: 30rpx;
}

.report-style-selector__skeleton--dots {
  position: absolute;
  bottom: 46rpx;
  width: 72rpx;
  height: 12rpx;
}

/* 汇报风格标签(940:191)：14px=28rpx，Inter Regular，#594342 */
.report-style-selector__style-label {
  position: relative;
  color: #594342;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
}

/* 风格名称(940:181)：33px=66rpx，Inter Bold，#1A1A1A；与标签底(252)间距=267-252=15px=30rpx */
.report-style-selector__style-name {
  position: relative;
  margin-top: 30rpx;
  color: #1a1a1a;
  font-size: 66rpx;
  font-weight: 700;
  line-height: 76rpx;
}

/* 风格说明(940:159)：14px=28rpx，Inter Regular，#999999；与名称底(307)间距=313-307=6px=12rpx */
.report-style-selector__style-desc {
  position: relative;
  margin-top: 12rpx;
  color: #999999;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 36rpx;
}

/* 分页圆点(940:182 8×6px 当前 / 940:183 6×6px 其余)，白底 */
.report-style-selector__dots {
  position: absolute;
  bottom: 46rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
}

.report-style-selector__dots .report-style-selector__dot {
  width: 12rpx;
  height: 12rpx;
  background: #fff;
  border-radius: 50%;
  opacity: 0.65;
}

.report-style-selector__dots .report-style-selector__dot--active {
  width: 16rpx;
  height: 12rpx;
  border-radius: 6rpx;
  opacity: 0.9;
}

/* 左右切换箭头图(940:192/134 24×24px=48×48rpx)，垂直居中于主体 */
.report-style-selector__switch {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: block;
  width: 48rpx;
  height: 48rpx;
  transform: translateY(-50%);
}

.report-style-selector__switch--right { right: 54rpx; }
.report-style-selector__switch:not(.report-style-selector__switch--right) { left: 54rpx; }
.report-style-selector__switch--disabled {
  pointer-events: none;
  opacity: 0.35;
}

/* —— ⑥ 权限说明(940:154)：14px=28rpx，Inter Regular，#999999；与主体底(382)间距=410-382=28px=56rpx —— */
.report-style-selector__permission-hint {
  display: block;
  width: 100%;
  margin-top: 56rpx;
  color: #999999;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ⑦ 权限数据胶囊区(120×120px=240×240rpx)：与说明底(427)间距=449-427=22px=44rpx —— */
.report-style-selector__permission-stage {
  position: relative;
  width: 100%;
  height: 456rpx;
  margin-top: 44rpx;
  flex-shrink: 0;
}

/* 胶囊(1004:17 等 120×120px=240×240rpx)：白底(0.9) + 渐变描边 + 内外阴影；
   stroke 线性渐变(垂直) #DAF0FF→#FFFFFF(49%)→#FFEBEB；
   box-shadow(px)：0 5px 20px 2px rgba(166,166,166,0.25)  drop；
                    inset 13px 19px 31px rgba(173,173,173,0.25)  inner */
.report-style-selector__capsule {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 240rpx;
  height: 240rpx;
  background: #ffffff;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    0 5px 20px 2px rgb(166 166 166 / 25%),
    inset 13px 19px 31px rgb(173 173 173 / 25%);
}

.report-style-selector__capsule--skeleton {
  background: #f1f3f6;
  box-shadow: none;
  animation: report-style-selector-skeleton-pulse 1.2s ease-in-out infinite;
}

/* 胶囊底图：选中=粉光玻璃(1004:20)、未选=纯白玻璃(1024:25)，铺满并裁成圆形 */
.report-style-selector__capsule-glow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 设计稿坐标（相对权限区顶, 1px=2rpx）：经营成本(32,449)、风险预警(213.5,447)、成本能耗(128.5,557) */
.report-style-selector__capsule--1 { left: 64rpx; top: 4rpx; }
.report-style-selector__capsule--2 { left: 427rpx; top: 0; }
.report-style-selector__capsule--3 { left: 257rpx; top: 216rpx; }

/* 勾选(940:161 20×20px=40×40rpx)：相对胶囊右上，top 15px=30rpx、right ~20px=40rpx（置于底图之上） */
.report-style-selector__capsule-check {
  position: absolute;
  top: 30rpx;
  right: 40rpx;
  z-index: 2;
  display: block;
  width: 40rpx;
  height: 40rpx;
}

/* 胶囊文字(940:160)：13px=26rpx，Inter Medium，#0B0B0B（置于底图之上） */
.report-style-selector__capsule-text {
  position: relative;
  z-index: 1;
  color: #0b0b0b;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 32rpx;
}

/* —— ⑧ CTA 按钮(940:132 319×56px=638×112rpx)：白底、radius 28px、红字 #C8201E；与胶囊底(677)间距=713-677=36px=72rpx；
   box-shadow(px)：0 -2px 21px rgba(0,0,0,0.06) —— */
.report-style-selector__selection-hint {
  height: 36rpx;
  margin-top: 36rpx;
  color: #c8201e;
  font-size: 26rpx;
  line-height: 36rpx;
}

.report-style-selector__button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 638rpx;
  height: 112rpx;
  margin-top: 72rpx;
  color: #c8201e;
  font-size: 34rpx;
  font-weight: 400;
  line-height: 42rpx;
  background: #fff;
  border-radius: 56rpx;
  box-shadow: 0 -2px 21px rgb(0 0 0 / 6.1%);
  flex-shrink: 0;
  /* 底部安全区：改由按钮自身承担，避免贴底按钮被系统导航栏/手势条遮挡。 */
  margin-bottom: var(--safe-bottom-px, 0px);
}

.report-style-selector__button--disabled {
  pointer-events: none;
  color: #999;
  opacity: 0.6;
}
</style>
