import type { ECharts } from "echarts";
import type { ComponentInternalInstance } from "vue";
import * as echarts from "echarts";

interface CanvasQueryResult {
  canvas: MiniProgramCanvas;
  width: number;
  height: number;
  dpr: number;
}

interface MiniProgramCanvas {
  width: number;
  height: number;
  style?: Record<string, string>;
  getContext: (type: string) => CanvasRenderingContext2D | null;
  addEventListener?: (...args: unknown[]) => void;
  removeEventListener?: (...args: unknown[]) => void;
  dispatchEvent?: (...args: unknown[]) => boolean;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

function getPixelRatio() {
  try {
    return Math.max(1, Number(uni.getSystemInfoSync().pixelRatio) || 2);
  } catch {
    return 2;
  }
}

function patchCanvasNode(canvas: MiniProgramCanvas, width: number, height: number, dpr: number) {
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style = { ...(canvas.style || {}), width: `${width}px`, height: `${height}px` };
  if (typeof canvas.addEventListener !== "function") canvas.addEventListener = () => {};
  if (typeof canvas.removeEventListener !== "function") canvas.removeEventListener = () => {};
  if (typeof canvas.dispatchEvent !== "function") canvas.dispatchEvent = () => false;
  const context = canvas.getContext("2d") as (CanvasRenderingContext2D & { canvas?: MiniProgramCanvas }) | null;
  if (context && !context.canvas) context.canvas = canvas;
  return canvas;
}

function createScopedQuery(instance: ComponentInternalInstance | null) {
  const query = uni.createSelectorQuery();
  return instance?.proxy ? query.in(instance.proxy) : query;
}

function execFieldsQuery(canvasId: string, instance: ComponentInternalInstance | null) {
  return new Promise<{ node?: MiniProgramCanvas; width?: number; height?: number } | null>((resolve) => {
    createScopedQuery(instance)
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((result) => {
        const info = Array.isArray(result) ? result[0] : result;
        resolve(info || null);
      });
  });
}

/**
 * 支付宝 canvas 2d：拿到真实节点后交给 echarts.init。
 * 拿不到节点就返回 null，由调用方决定重试或降级。
 */
export async function queryAlipayChartCanvas(
  canvasId: string,
  instance: ComponentInternalInstance | null,
): Promise<CanvasQueryResult | null> {
  const info = await execFieldsQuery(canvasId, instance);
  const canvas = info?.node;
  const width = Number(info?.width) || 0;
  const height = Number(info?.height) || 0;
  if (!canvas || width <= 0 || height <= 0) return null;

  const dpr = getPixelRatio();
  patchCanvasNode(canvas, width, height, dpr);
  return { canvas, width, height, dpr };
}

export function initAlipayEcharts(
  canvas: MiniProgramCanvas,
  width: number,
  height: number,
  dpr: number,
): ECharts {
  // createCanvas 是全局 API，但 init 同步，只在本次初始化窗口内指向当前画布
  echarts.setPlatformAPI({
    createCanvas() {
      return canvas as unknown as HTMLCanvasElement;
    },
  });
  return echarts.init(canvas as unknown as HTMLCanvasElement, null, {
    width,
    height,
    devicePixelRatio: dpr,
    renderer: "canvas",
  });
}

export function dispatchAlipayChartTouch(chart: ECharts, type: string, event: UniTouchEvent) {
  const handler = chart.getZr()?.handler;
  if (!handler) return;
  const touches = event.touches || event.changedTouches || [];
  for (const touch of touches) {
    const point = touch as UniTouchEvent["touches"][number] & { offsetX?: number; offsetY?: number };
    point.offsetX = Number(point.x ?? point.clientX ?? 0);
    point.offsetY = Number(point.y ?? point.clientY ?? 0);
  }
  handler.dispatch(type, event);
}

interface UniTouchEvent {
  touches: Array<{ x?: number; y?: number; clientX?: number; clientY?: number }>;
  changedTouches?: Array<{ x?: number; y?: number; clientX?: number; clientY?: number }>;
}
