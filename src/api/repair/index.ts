import type { RepairInformationPayload } from "./types";
import { createLogger } from "@/utils/logger";
import { platformRequest } from "@/utils/platform/http-request";
import { SANVIST_H5_ORIGIN } from "@/utils/sanvist-h5-encrypt";

const logger = createLogger("repair-api");

/**
 * 拉三方维修助理的「案例报告」状态（机型 / 故障现象 / 交互排查 / 交互维修）。
 *
 * 不走本工程的 `request`：
 * - 目标是三方域（maix-bm），本工程的 baseURL 拼不上；
 * - Authorization / Guest-Role 是我们的身份，没有理由外发给三方；
 * - 只是一次状态读取，失败交给调用方当「还没生成完」继续轮询（request 层已自带 url / 状态码日志）。
 */
export async function getRepairInformationState(conversationId: string) {
  const id = String(conversationId || "").trim();
  if (!id) throw new Error("缺少维修助理会话 ID");

  const path = `/v1/conversations/${encodeURIComponent(id)}/repair-information/state`;
  const response = await platformRequest<RepairInformationPayload>(SANVIST_H5_ORIGIN, "GET", path, {
    headers: { Accept: "application/json" },
    timeout: 10_000,
  });

  logger.debug("案例报告状态返回", {
    conversationId: id,
    updatedAt: response.data?.updatedAt || "(空)",
  });
  return response.data;
}
