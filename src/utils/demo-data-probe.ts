import { createLogger } from "@/utils/logger";
import { getDemoModeData, saveDemoModeData, waitForMpaas } from "@/utils/platform/mpaas";

const logger = createLogger("demo-probe");

/**
 * `saveDemoModeData` / `getDemoModeData` 自检开关。
 *
 * 只用于排查「点卡片写 gantt_view 失败」这类问题：在作业协同页 onLoad 里跑一次
 * 「写一段几百字符的 JSON → 立刻读回 → 比对是否一致」，把桥的能力和体积边界先固定下来。
 * 排查完把开关关掉（或直接删掉这个文件与调用点）即可。
 */
export const DEMO_DATA_PROBE_ENABLED = true;

/** 自检用的 key：必须与业务 key（gantt_view / gantt_ask）错开，避免覆盖真实数据 */
const PROBE_KEY = "demo_probe";

/** 等 bridge 注入的上限：页面 onLoad 阶段桥可能还没到 */
const PROBE_BRIDGE_WAIT_MS = 1500;

/**
 * 构造一段几百字符的 JSON：中文 + 数组 + 嵌套 + 浮点，形状尽量接近业务报文。
 * 3 行数据 ≈ 400B 左右，具体字节数以日志里的 `bytes` 为准。
 */
function buildProbePayload(now: number) {
  return {
    seq: now,
    at: new Date(now).toISOString(),
    text: "作业协同初始化自检：saveDemoModeData / getDemoModeData 往返测试",
    rows: Array.from({ length: 3 }, (_, index) => ({
      id: `row-${index}`,
      name: `资源${index + 1}号`,
      bars: [
        {
          id: `bar-${index}`,
          title: `任务${index + 1}`,
          startMin: 480 + index * 15,
          endMin: 540 + index * 15.5,
          state: "planned",
        },
      ],
    })),
  };
}

function safeStringify(data: unknown) {
  try {
    return JSON.stringify(data);
  }
  catch {
    return "";
  }
}

/**
 * 跑一次 demo 数据桥自检。
 *
 * @param trigger 触发点标识（只用于日志区分，比如 task-onload / card-click）
 * @returns 写入并读回一致的 true；任一步失败返回 false
 */
export async function probeDemoModeData(trigger = "manual"): Promise<boolean> {
  if (!DEMO_DATA_PROBE_ENABLED) return false;

  const startedAt = Date.now();
  const bridge = await waitForMpaas(PROBE_BRIDGE_WAIT_MS);
  if (!bridge) {
    logger.warn(`自检跳过（${trigger}）：${PROBE_BRIDGE_WAIT_MS}ms 内没拿到 AlipayJSBridge`);
    return false;
  }

  const payload = buildProbePayload(startedAt);
  const bytes = safeStringify(payload).length;
  logger.info(`自检开始（${trigger}）`, {
    key: PROBE_KEY,
    bytes,
    bridgeReadyCostMs: Date.now() - startedAt,
  });

  // 1) 写入（这一步超时 = 宿主没注册这个 JSAPI，回调压根不会来）
  const writeStartedAt = Date.now();
  let writeOk = false;
  let writeCostMs = 0;
  try {
    await saveDemoModeData(PROBE_KEY, payload);
    writeOk = true;
    writeCostMs = Date.now() - writeStartedAt;
    logger.info("自检：写入成功", { key: PROBE_KEY, bytes, costMs: writeCostMs });
  }
  catch (error) {
    writeCostMs = Date.now() - writeStartedAt;
    logger.error(
      `自检失败（${trigger}）：saveDemoModeData 写入失败`,
      {
        key: PROBE_KEY,
        bytes,
        costMs: writeCostMs,
        message: error instanceof Error ? error.message : String(error),
      },
      error,
    );
  }

  // 2) 不论写入成败都读一次：读能拿到错误码（如 not implemented）就能证明是「宿主未实现」，
  //    而不是我们参数写错。getDemoModeData 内部已 catch，失败返回 null。
  const readStartedAt = Date.now();
  const back = await getDemoModeData<Record<string, unknown>>(PROBE_KEY);
  const readCostMs = Date.now() - readStartedAt;
  const backBytes = safeStringify(back).length;
  const same = writeOk && safeStringify(back) === safeStringify(payload);

  if (same) {
    logger.warn(`自检通过（${trigger}）：写入 ${bytes}B / 读回一致`, {
      key: PROBE_KEY,
      bytes,
      writeCostMs,
      readCostMs,
      totalCostMs: Date.now() - startedAt,
    });
    return true;
  }

  logger.warn(`自检异常（${trigger}）：demo 数据桥不可用`, {
    key: PROBE_KEY,
    bytes,
    writeOk,
    writeCostMs,
    readCostMs,
    readOk: back != null,
    backBytes,
    backType: typeof back,
    // 截断预览，避免刷屏
    backPreview: safeStringify(back).slice(0, 160),
    // 写超时且读不到值 ⇒ 宿主未实现 saveDemoModeData / getDemoModeData（或未给当前 appId 授权）
    conclusion: writeOk
      ? "写入成功但读回为空/不一致：宿主存储实现或返回结构有问题"
      : "写入无回调（超时）：宿主未实现 saveDemoModeData，或当前 H5 的 appId 不在 JSAPI 白名单内",
  });
  return false;
}
