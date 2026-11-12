/**
 * SANVIST H5 加密接入 — 按环境生成三方页面 URL。
 *
 * 算法：RSA-OAEP / SHA-256，2048-bit；明文 UTF-8 ≤ 190 字节；密文 base64。
 * payload 仅 4 字段：externalUserId / name / timestamp / nonce。
 */
import forge from "node-forge";
import { createLogger } from "@/utils/logger";

const logger = createLogger("sanvist-h5");

/** 明文 UTF-8 字节上限（RSA-OAEP 2048 上限约 190 字节）。 */
const PAYLOAD_MAX_BYTES = 190;

const TEST_FRONTEND = "https://maix-bm.irootech.com/repair";
const PROD_FRONTEND = "https://maix-bm.irootech.com/repair";
// const PROD_FRONTEND = "https://fixmasterai.sany.com.cn";

/** 仅 `pnpm build:h5` 注入 production，其余命令都走测试地址。 */
const DEFAULT_FRONTEND =
  import.meta.env.VITE_SANVIST_H5_FRONTEND === "production" ? PROD_FRONTEND : TEST_FRONTEND;

/**
 * 三方站点的根地址（`https://maix-bm.irootech.com`）。
 * 调三方的接口（如案例报告状态）时用它拼 baseURL，避免另写一份域名跟前端地址漂移。
 */
export const SANVIST_H5_ORIGIN = new URL(DEFAULT_FRONTEND).origin;
const DEFAULT_SOURCE = "sanvist";
const DEFAULT_SYS_CODE = "sanvist";
const DEFAULT_EXTERNAL_USER_ID = "shengmz2";
const DEFAULT_NAME = "smz2";
/** 外部主题兜底值：拿不到具体外观时按浅色（appAppearance 只会有 light / dark） */
const DEFAULT_THEME = "light";
/** 公司 / 组织兜底：宿主没下发、用户信息里也没有时沿用 sanvist 默认租户（与维修助理同一口径） */
const DEFAULT_COMPANY_ID = "69";
const DEFAULT_ORGANIZATION_ID = "2";

/**
 * sanvist H5 公钥（PEM）。
 * 密钥轮换后请同步更新此处。
 */
const SANVIST_H5_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAm/m6Ncv++MO6HO2Iaop/
ao6CQSe0PoQgYiD43LFlM0QEurvte6UsqjMz7Z7sTVQj2dzNGwwWiA+9ACtXkGD0
qyTfka6VuB4X4m9chG4KFHrKtfSabqBxhd2lWhgdb16GzvCpB3ETvO3a1h/rlriq
ZcZOsPIQs4XrL8F0IYTa90Jsril6/dMurtfOpOGo1h5FJo1/S9P7KmiZuogwpbeA
v2Zs7ik1uBhZ0NiKCwrNASkcbVCkhvAWJ0p36def3GXTAy0p+L7ZugPS9eikWfYS
d97eu4e5spN5Biwpy9dW6Dxxrh9dddzkSTBFGF+YyhGgbPlmdoIjOOFrYMywj6PG
9QIDAQAB
-----END PUBLIC KEY-----`;

export interface SanvistH5Payload {
  externalUserId: string;
  name: string;
  timestamp: number;
  nonce: string;
}

export interface SanvistH5EncryptOptions {
  externalUserId?: string;
  name?: string;
  sysCode?: string;
  source?: string;
  frontend?: string;
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  /** 维修助理详情页的会话 ID，直接接在 frontend 后面（`/repair/{id}`）。 */
  chatConversationId?: string;
  /**
   * 外观主题：直接透传设置弹层里选中的外观值（system / light / dark），
   * 由三方 H5 自己决定怎么落地，前端不再二次换算成 light/dark。
   */
  theme?: string;
  /** 音色：透传选中的音色 id（与听播 TTS 用的是同一套 voice code），未传则不带该参数 */
  voice?: string;
  /**
   * 界面语言：透传设置里选中的中英文值（zh_CN / en_US），URL 参数名用 `language`。
   * 未传时保留固定下发的默认值 `language=zh-CN`；传了则覆盖为宿主口径的值。
   */
  language?: string;
  /** 公司 id，缺省用 sanvist 侧默认租户（69） */
  companyId?: string;
  /** 组织 id，缺省用 sanvist 侧默认组织（2） */
  organizationId?: string;
  /**
   * 追加参数：三方页各自额外要的键值（如配件助手的 `gatewayHost` / `access_token`），
   * 统一在最后写入；空值自动跳过，不会覆盖上面已算好的业务参数。
   */
  extraParams?: Record<string, string | undefined>;
}

export interface SanvistH5EncryptResult {
  payload: SanvistH5Payload;
  plaintext: string;
  bytes: number;
  ciphertext: string;
  encoded: string;
  url: string;
}

function utf8ByteLength(text: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

function createNonce() {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

function buildPayload(externalUserId: string, name: string): SanvistH5Payload {
  return {
    externalUserId,
    name,
    timestamp: Date.now(),
    nonce: createNonce(),
  };
}

function encryptPayload(payload: SanvistH5Payload) {
  const plaintext = JSON.stringify(payload);
  const bytes = utf8ByteLength(plaintext);
  if (bytes > PAYLOAD_MAX_BYTES) {
    throw new Error(
      `payload 过大 (${bytes} bytes)，RSA-OAEP-SHA256 2048 上限约 190 字节。\nplaintext=${plaintext}`,
    );
  }

  const publicKey = forge.pki.publicKeyFromPem(SANVIST_H5_PUBLIC_KEY_PEM);
  const encrypted = publicKey.encrypt(forge.util.encodeUtf8(plaintext), "RSA-OAEP", {
    md: forge.md.sha256.create(),
    mgf1: {
      md: forge.md.sha256.create(),
    },
  });

  return {
    plaintext,
    bytes,
    ciphertext: forge.util.encode64(encrypted),
  };
}

/**
 * 把参数接到 frontend 上。
 *
 * frontend 允许自带 query 与 hash（配件助手入口就是 `.../dist/?source=pjzs-sanvist#/agent`）：
 * - 参数一律拼在 hash 之前，落到 `#/agent` 后面三方就取不到了；
 * - frontend 里已经写死的同名参数保持原值（例如 `source=pjzs-sanvist`），
 *   不覆盖它对接入口径的约定。
 */
function composeUrl(frontend: string, detailPath: string, params: URLSearchParams) {
  try {
    const target = new URL(frontend);
    if (detailPath) {
      target.pathname = `${target.pathname.replace(/\/$/, "")}${detailPath}`;
    }
    const merged = new URLSearchParams(target.search);
    params.forEach((value, key) => {
      if (!merged.has(key)) merged.set(key, value);
    });
    target.search = merged.toString();
    return target.href;
  }
  catch {
    // 不是绝对地址（理论上不会出现）：退回最朴素的拼接
    return `${frontend.replace(/\/$/, "")}${detailPath}?${params.toString()}`;
  }
}

/**
 * `gatewayHost` 里是 `https://` 这种地址，URLSearchParams 会把它转义成
 * `https%3A%2F%2F...`；三方页有按原始字符串取值的情况，这里还原成未转义形态
 * （`:` 与 `/` 在 query 里本身是合法字符，标准解析结果不变）。
 */
function decodeGatewayHost(url: string) {
  return url.replace(/([?&]gatewayHost=)([^&#]*)/, (_match, prefix: string, value: string) => (
    prefix + value.replace(/%3A/gi, ":").replace(/%2F/gi, "/")
  ));
}

/**
 * 使用 node-forge 加密用户信息，并按当前环境拼出可直接访问的 URL。
 */
export function buildSanvistH5Url(options: SanvistH5EncryptOptions = {}): SanvistH5EncryptResult {
  const externalUserId = options.externalUserId || DEFAULT_EXTERNAL_USER_ID;
  const name = options.name || DEFAULT_NAME;
  const sysCode = options.sysCode || DEFAULT_SYS_CODE;
  const source = options.source || DEFAULT_SOURCE;
  const frontend = String(options.frontend || DEFAULT_FRONTEND).replace(/\/$/, "");

  const payload = buildPayload(externalUserId, name);
  const { plaintext, bytes, ciphertext } = encryptPayload(payload);
  const encoded = encodeURIComponent(ciphertext);
  const params = new URLSearchParams({
    source,
    sysCode,
    ciphertext,
    language: "zh-CN",
    // 公司 / 组织：三方页自己取不到，由调用方按宿主身份注入，缺省沿用 sanvist 默认租户
    companyId: String(options.companyId || "").trim() || DEFAULT_COMPANY_ID,
    organizationId: String(options.organizationId || "").trim() || DEFAULT_ORGANIZATION_ID,
    isChinaMode: "true",
    isConsumer: "true",
    // 外观：透传当前生效的外观值（light / dark），未显式传入时按浅色处理
    theme: String(options.theme || "").trim() || DEFAULT_THEME,
  });
  const userId = String(options.userId || "").trim();
  const sessionId = String(options.sessionId || "").trim();
  const conversationId = String(options.conversationId || "").trim();
  const chatConversationId = String(options.chatConversationId || "").trim();
  const voice = String(options.voice || "").trim();
  const language = String(options.language || "").trim();
  if (userId) params.set("userId", userId);
  if (sessionId) params.set("sessionId", sessionId);
  if (conversationId) params.set("conversationId", conversationId);
  // 音色 id（如 xieshurou_v3.1）：与听播 TTS 同一个 code，回调方可据此复用同一音色
  if (voice) params.set("voice", voice);
  // 界面语言（zh_CN / en_US）：参数名统一为 `language`，未传时保留上面的默认值 zh-CN
  if (language) params.set("language", language);
  // 三方页各自追加的参数（如配件助手的 gatewayHost / access_token）：空值跳过
  Object.entries(options.extraParams || {}).forEach(([key, value]) => {
    const text = String(value ?? "").trim();
    if (text) params.set(key, text);
  });
  /**
   * 路径：入口直接落在 frontend（`https://maix-bm.irootech.com/repair`），不再补 `/chat` ——
   * 三方最新版把对话页放在根路径上，旧的 `/repair/chat` 是历史地址。
   *
   * 「快问快答 / 诊断中 / 诊断完成」这些回流卡点进去要带上会话 id，
   * 三方约定直接接在 repair 后面：`https://maix-bm.irootech.com/repair/{conversationId}?source=...`，
   * 其余 query 一个不动。
   */
  const detailPath = chatConversationId ? `/${encodeURIComponent(chatConversationId)}` : "";
  const url = decodeGatewayHost(composeUrl(frontend, detailPath, params));
  // 只打目标路径与参数名：ciphertext / access_token 都是鉴权值，不落日志
  const paramNames: string[] = [];
  params.forEach((_value, key) => {
    paramNames.push(key);
  });
  logger.info("sanvist h5 地址已拼好", { target: `${frontend}${detailPath}`, params: paramNames });

  return {
    payload,
    plaintext,
    bytes,
    ciphertext,
    encoded,
    url,
  };
}
