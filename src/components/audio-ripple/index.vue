<script setup lang="ts">
import type {
  AudioRippleInputAppearance,
  AudioRippleOutputAppearance,
  AudioRippleTextureAppearance,
  RippleImages,
  RipplePalette,
  RippleSettings,
  RippleSize,
} from "./audio-ripple-model";
import darkInputUrl from "@/assets/img/audio-ripple/audio-ripple-input-dark.svg";
import textureUrl from "@/assets/img/audio-ripple/audio-ripple-texture.png";
import darkTextureUrl from "@/assets/img/audio-ripple/audio-ripple-texture-dark.svg";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PropType } from "vue";
import { defaultAudioRippleAppearance, defaultAudioRippleIdleSpeed } from "./audio-ripple-model";
import { createAudioRippleRenderer } from "./audio-ripple-renderer";

defineOptions({ name: "AudioRipple" });

/**
 * 声纹动画（迁移自 audio-ripple 工程）。
 *
 * 与原实现的差别只在「谁来驱动」：
 * 原版把 AnalyserNode 的时域 / 频域数据喂给渲染器；本项目的语音播报走
 * `uni.createInnerAudioContext()`，拿不到 WebAudio 的分析节点，所以统一用
 * `preview="speech"` —— 渲染器内部本来就有这套「按语句 / 音节包络合成频谱」的分支，
 * 视觉与真实语音一致，且不依赖音频通道。
 *
 * 渲染放在主线程（原版可选 worker 转移 OffscreenCanvas，H5 内嵌容器里收益有限、
 * 兼容性反而更差），每帧由渲染器自己节流到 30fps。
 */
const props = defineProps({
  /** input：录音（边缘向内收）；error：失败；output：播报（边缘光带） */
  variant: { type: String as PropType<"input" | "error" | "output">, default: "output" },
  /** speech / silence / static：合成信号，不读真实音频 */
  preview: { type: String as PropType<"speech" | "silence" | "static">, default: "speech" },
  /** 深色主题：影响纹理混合方式与描边层次 */
  dark: { type: Boolean, default: false },
  /** 静止时环境扰动的速度 */
  idleSpeed: { type: Number, default: defaultAudioRippleIdleSpeed },
  /** 渲染倍率上限：全屏铺满时降到 1，能省掉一半以上的逐像素开销 */
  pixelRatio: { type: Number, default: 1.2 },
  inputAppearance: { type: Object as PropType<Partial<AudioRippleInputAppearance>>, default: () => ({}) },
  outputAppearance: { type: Object as PropType<Partial<AudioRippleOutputAppearance>>, default: () => ({}) },
  textureAppearance: { type: Object as PropType<Partial<AudioRippleTextureAppearance>>, default: () => ({}) },
});

/** view 组件实例（H5 下 $el 才是真实 DOM） */
const root = ref<{ $el?: HTMLElement } | null>(null);

function rootElement() {
  return (root.value?.$el || root.value) as HTMLElement | null;
}

/**
 * 默认调色板：原工程的这 4 个色值来自使用方的 CSS 变量（`--audio-ripple-*-0..3`），
 * 本工程没有那套 token，按品牌色在这里给一份默认值，需要换色改这里即可。
 * 每个数组是 4 个颜色 × RGBA，首尾相接成环，改色时保持首尾一致避免接缝。
 */
const PALETTE_COLORS = {
  /** 播报：沿弧线从左到右 #3D21CD（紫）→ #0091FF（蓝）→ #4043FF（蓝紫）→ #FC8FC4（粉） */
  output: [0x3D, 0x21, 0xCD, 0xFF, 0x00, 0x91, 0xFF, 0xFF, 0x40, 0x43, 0xFF, 0xFF, 0xFC, 0x8F, 0xC4, 0xFF],
  /** 录音：蓝 */
  input: [0x1B, 0x72, 0xCF, 0xFF, 0x4F, 0xA3, 0xF7, 0xFF, 0x8F, 0xD3, 0xFF, 0xFF, 0x1B, 0x72, 0xCF, 0xFF],
  /** 失败：红 */
  error: [0xFF, 0x3B, 0x30, 0xFF, 0xFF, 0x6B, 0x6B, 0xFF, 0xFF, 0xB3, 0xB3, 0xFF, 0xFF, 0x3B, 0x30, 0xFF],
};

function buildPalette(dark: boolean): RipplePalette {
  return {
    dark,
    input: new Float32Array(PALETTE_COLORS.input),
    error: new Float32Array(PALETTE_COLORS.error),
    output: new Float32Array(PALETTE_COLORS.output),
  };
}

type Renderer = ReturnType<typeof createAudioRippleRenderer>;

let renderer: Renderer | null = null;
let surface: HTMLCanvasElement | null = null;
let frame = 0;
let disposed = false;
let observer: ResizeObserver | null = null;

function settings(): RippleSettings {
  return {
    variant: props.variant,
    preview: props.preview,
    idleSpeed: props.idleSpeed,
    inputAppearance: props.inputAppearance,
    outputAppearance: props.outputAppearance,
    textureAppearance: props.textureAppearance,
  };
}

function size(): RippleSize {
  const element = rootElement();
  return {
    width: element?.clientWidth || 0,
    height: element?.clientHeight || 0,
    // 内嵌 WebView 上逐像素运算的开销跟 DPR 直接相关，默认压到 1.2 以内既清晰又不掉帧
    ratio: Math.min(window.devicePixelRatio || 1, Math.max(0.5, props.pixelRatio)),
  };
}

function stopFrames() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function startFrames() {
  stopFrames();
  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    renderer?.draw(now);
  };
  frame = requestAnimationFrame(draw);
}

const reducedMotion = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

function onVisibilityChange() {
  if (!renderer) return;
  if (document.hidden) {
    stopFrames();
    return;
  }
  renderer.resume();
  startFrames();
}

function onMotionChange() {
  renderer?.setMotion(Boolean(reducedMotion?.matches));
}

async function loadImages(): Promise<RippleImages<HTMLImageElement>> {
  const urls = { texture: textureUrl, darkTexture: darkTextureUrl, darkInput: darkInputUrl };
  const result: RippleImages<HTMLImageElement> = { texture: null, darkTexture: null, darkInput: null };
  await Promise.all((Object.keys(urls) as Array<keyof typeof urls>).map(async (key) => {
    const image = new Image();
    image.src = urls[key];
    try {
      await image.decode();
      result[key] = image;
    }
    catch {
      // 装饰性素材缺失不该让整块动画不可用
    }
  }));
  return result;
}

onMounted(() => {
  const element = rootElement();
  if (!element || typeof document === "undefined") return;
  disposed = false;
  surface = document.createElement("canvas");
  element.append(surface);

  observer = new ResizeObserver(() => renderer?.resize(size()));
  observer.observe(element);
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotion?.addEventListener("change", onMotionChange);

  void (async () => {
    const images = await loadImages();
    if (disposed || !surface) return;
    renderer = createAudioRippleRenderer(
      surface,
      () => document.createElement("canvas"),
      settings(),
      buildPalette(props.dark),
      images,
    );
    renderer.setMotion(Boolean(reducedMotion?.matches));
    renderer.setSignal(null);
    renderer.resize(size());
    if (document.hidden) return;
    startFrames();
  })();
});

watch(
  () => [props.variant, props.preview, props.idleSpeed, props.inputAppearance, props.outputAppearance, props.textureAppearance],
  () => renderer?.update(settings()),
  { deep: true },
);

watch(
  () => props.dark,
  dark => renderer?.setPalette(buildPalette(dark)),
);

onBeforeUnmount(() => {
  disposed = true;
  stopFrames();
  renderer = null;
  observer?.disconnect();
  observer = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  reducedMotion?.removeEventListener("change", onMotionChange);
  surface?.remove();
  surface = null;
});
</script>

<template>
  <view ref="root" class="audio-ripple" aria-hidden="true" />
</template>

<style lang="scss" scoped>
.audio-ripple {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  isolation: isolate;

  :deep(canvas) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
