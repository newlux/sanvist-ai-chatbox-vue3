/**
 * SANVIST H5 加密接入 — 按环境生成三方页面 URL。
 *
 * 算法：RSA-OAEP / SHA-256，2048-bit；明文 UTF-8 ≤ 190 字节；密文 base64。
 * payload 仅 4 字段：externalUserId / name / timestamp / nonce。
 */
import forge from "node-forge";

/** 明文 UTF-8 字节上限（RSA-OAEP 2048 上限约 190 字节）。 */
const PAYLOAD_MAX_BYTES = 190;

const TEST_FRONTEND = "https://sprouts-dev-app-frontend.sany.com.cn";
const PROD_FRONTEND = "https://fixmasterai.sany.com.cn";
/** 仅 `pnpm build:h5` 注入 production，其余命令都走测试地址。 */
const DEFAULT_FRONTEND = import.meta.env.VITE_SANVIST_H5_FRONTEND === "production" ? PROD_FRONTEND : TEST_FRONTEND;
const DEFAULT_SOURCE = "sanvist";
const DEFAULT_SYS_CODE = "sanvist";
const DEFAULT_EXTERNAL_USER_ID = "shengmz2";
const DEFAULT_NAME = "smz2";

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
    throw new Error(`payload 过大 (${bytes} bytes)，RSA-OAEP-SHA256 2048 上限约 190 字节。\nplaintext=${plaintext}`);
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
  const url = `${frontend}/chat?source=${encodeURIComponent(source)}&sysCode=${encodeURIComponent(sysCode)}&ciphertext=${encoded}`;

  return {
    payload,
    plaintext,
    bytes,
    ciphertext,
    encoded,
    url,
  };
}
