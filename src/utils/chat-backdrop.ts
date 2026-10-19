import craneImage from "@/assets/img/chat-bg-crane.png";
import pumpTruckImage from "@/assets/img/chat-bg-pump-truck.png";

/**
 * 对话框设备背景图（Ardot 7297:145 履带吊 / 7297:278 混凝土泵车）。
 *
 * 图片放在 src/assets/img 下、按 `@/assets/img/...` 引用（构建时由 vite 打包成带 hash 的资源 URL）：
 * 不要写 `/static/chat-bg/xxx.png` 这类绝对路径——文件不在 src/static 时请求直接 404，
 * 表现就是「选了机型但背景图不出来」。
 *
 * 两个类型的稿子只有「图 + 位置」不同，其余一致：左右各留 20px（375 宽稿）、透明度 20%。
 * - 履带吊：距页面顶部 122px（稿 812 高）→ 15%
 * - 混凝土泵车：距顶部 313px → 38.5%
 * 这里只按机型归类，具体渲染交给 AiChatBackdrop 组件。
 */
export type ChatBackdropKey = "crane" | "pumpTruck";

export interface ChatBackdrop {
  key: ChatBackdropKey;
  /** 打包后的图片地址（构建产物里的带 hash 路径） */
  src: string;
  /** 距页面顶部的百分比（按 812 高稿换算，适配不同屏高） */
  topPercent: number;
}

const BACKDROPS: Record<ChatBackdropKey, ChatBackdrop> = {
  crane: { key: "crane", src: craneImage, topPercent: 15 },
  pumpTruck: { key: "pumpTruck", src: pumpTruckImage, topPercent: 38.5 },
};

/**
 * 机型 → 设备类型：SCC 是履带吊、THB 是混凝土泵车（型号名里带中文类型时同样识别）。
 * 认不出的类型不配背景，避免给错图。
 */
function resolveBackdropKey(modelKey: string, modelName: string): ChatBackdropKey | null {
  const key = modelKey.toUpperCase();
  if (key.startsWith("SCC") || modelName.includes("履带吊")) return "crane";
  if (key.includes("THB") || modelName.includes("泵车")) return "pumpTruck";
  return null;
}

/** 按用户选择的机型解析对话框背景；未选择机型或类型没有对应设计稿时返回 null */
export function resolveChatBackdrop(modelKey?: string, modelName?: string): ChatBackdrop | null {
  const resolved = resolveBackdropKey(String(modelKey || "").trim(), String(modelName || "").trim());
  return resolved ? BACKDROPS[resolved] : null;
}
