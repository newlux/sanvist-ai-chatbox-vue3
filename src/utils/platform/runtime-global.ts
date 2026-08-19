/**
 * 支付宝真机 JSVM 没有 `globalThis`，直接访问会抛
 * `ReferenceError: globalThis is not defined`。
 * 宿主注入的全局用 typeof 读取。
 */

export function getAlipayJSBridge(): typeof AlipayJSBridge | undefined {
  try {
    if (typeof AlipayJSBridge !== "undefined") return AlipayJSBridge;
  } catch {
    return undefined;
  }
  return undefined;
}
