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

interface NodeQueryResult {
  node?: MiniProgramCanvas;
  width?: number;
  height?: number;
}

/** SelectorQuery.fields({node:true})：微信同款写法，支付宝新基础库也支持 */
function execFieldsQuery(canvasId: string, instance: ComponentInternalInstance | null) {
  return new Promise<NodeQueryResult | null>((resolve) => {
    try {
      createScopedQuery(instance)
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((result) => {
          const info = Array.isArray(result) ? result[0] : result;
          resolve((info || null) as NodeQueryResult | null);
        });
    } catch (error) {
      console.warn("[chart] fields({node}) 查询失败", error);
      resolve(null);
    }
  });
}

/** 只取尺寸。node 走 my.createCanvas 时用它补上宽高 */
function execRectQuery(canvasId: string, instance: ComponentInternalInstance | null) {
  return new Promise<{ width?: number; height?: number } | null>((resolve) => {
    try {
      createScopedQuery(instance)
        .select(`#${canvasId}`)
        .boundingClientRect((rect) => {
          resolve((Array.isArray(rect) ? rect[0] : rect) as { width?: number; height?: number } | null);
        })
        .exec();
    } catch (error) {
      console.warn("[chart] boundingClientRect 查询失败", error);
      resolve(null);
    }
  });
}

/**
 * my.createCanvas：老基础库上 SelectorQuery 不认 node:true，
 * 只有这个接口能拿到真正的 canvas 对象。
 */
function createCanvasByApi(canvasId: string) {
  return new Promise<MiniProgramCanvas | null>((resolve) => {
    const api = (typeof my !== "undefined" ? my : null) as {
      createCanvas?: (options: {
        id: string;
        success?: (canvas: MiniProgramCanvas) => void;
        fail?: (error: unknown) => void;
      }) => void;
    } | null;
    if (typeof api?.createCanvas !== "function") {
      resolve(null);
      return;
    }
    try {
      api.createCanvas({
        id: canvasId,
        success: canvas => resolve(canvas || null),
        fail: (error) => {
          console.warn("[chart] my.createCanvas 失败", error);
          resolve(null);
        },
      });
    } catch (error) {
      console.warn("[chart] my.createCanvas 抛错", error);
      resolve(null);
    }
  });
}

/**
 * 支付宝 canvas 2d：拿到真实节点后交给 echarts.init。
 * 基础库版本差异较大，这里按 fields({node}) → my.createCanvas 依次尝试，
 * 都拿不到就返回 null，由调用方重试或降级成数据清单。
 */
export async function queryAlipayChartCanvas(
  canvasId: string,
  instance: ComponentInternalInstance | null,
): Promise<CanvasQueryResult | null> {
  const info = await execFieldsQuery(canvasId, instance);
  let canvas = info?.node || null;
  let width = Number(info?.width) || 0;
  let height = Number(info?.height) || 0;

  if (!canvas) {
    canvas = await createCanvasByApi(canvasId);
    if (canvas) console.info("[chart] canvas 由 my.createCanvas 获取");
  }
  if (!canvas) return null;

  if (width <= 0 || height <= 0) {
    const rect = await execRectQuery(canvasId, instance);
    width = Number(rect?.width) || width;
    height = Number(rect?.height) || height;
  }
  if (width <= 0 || height <= 0) return null;
  if (typeof canvas.getContext !== "function") {
    console.warn("[chart] canvas 节点不支持 getContext，放弃渲染");
    return null;
  }

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
