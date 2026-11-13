import type { PushConnectionState } from "./types";
import {
  PUSH_AUTH_FAIL_DELAY_MS,
  PUSH_CONNECT_TIMEOUT_MS,
  PUSH_KEEPALIVE_SECONDS,
  PUSH_RECONNECT_MAX_DELAY_MS,
  PUSH_RECONNECT_MIN_DELAY_MS,
} from "@/config/push";
import { createLogger } from "@/utils/logger";

const logger = createLogger("push-mqtt");

/**
 * 车载端推送用的 MQTT over WebSocket 客户端（MQTT 3.1.1）。
 *
 * 为什么自己写而不是引 mqtt.js：
 * - 这里只用到「CONNECT / SUBSCRIBE / 收 PUBLISH + PUBACK / PING」四类报文，
 *   协议文档 4.3 也明确一期客户端不需要向任何 topic 发布消息；
 * - mqtt.js 的浏览器构建约 370KB，且会在低端安卓 WebView 里塞进大量 Node polyfill，
 *   对「以 H5 内嵌在 mPaaS WebView」的形态不划算。
 *
 * 行为对齐协议 4.x：
 * - Client ID / 用户名 = 车载设备号，口令走配置；
 * - Clean Session = false（服务端保留订阅与未确认的 QoS 1 消息 24 小时，重连自动补投）；
 * - Keep Alive 30s，连续一个周期没收到 PINGRESP 就判定链路已死并重连；
 * - 认证失败（CONNACK 4/5、SUBACK 0x80）按协议 4.2 退避 5 分钟，不得高频重连。
 *
 * 所有失败都不抛异常，只切状态并排重连 —— 页面据此渲染「重连中 / 认证失败」。
 */

/** 报文类型（高 4 位） */
const PACKET_CONNECT = 0x10;
const PACKET_CONNACK = 0x20;
const PACKET_PUBLISH = 0x30;
const PACKET_PUBACK = 0x40;
const PACKET_SUBSCRIBE = 0x82;
const PACKET_SUBACK = 0x90;
const PACKET_PINGREQ = 0xc0;
const PACKET_PINGRESP = 0xd0;
const PACKET_DISCONNECT = 0xe0;

/** MQTT 3.1.1 协议级别 */
const PROTOCOL_LEVEL = 4;
/** 协议名固定 "MQTT" */
const PROTOCOL_NAME = "MQTT";
/** WebSocket 子协议：EMQX 等 Broker 要求握手时带上 */
const WS_SUBPROTOCOL = "mqtt";

/** CONNACK 返回码：4 = 用户名或口令错误，5 = 未授权 */
const CONNACK_BAD_CREDENTIALS = 4;
const CONNACK_NOT_AUTHORIZED = 5;
/** SUBACK 失败码：0x80 */
const SUBACK_FAILURE = 0x80;

export interface MqttPushClientOptions {
  /** wss://host:port/mqtt */
  url: string;
  /** = 车载设备号 */
  clientId: string;
  username: string;
  password: string;
  /** 订阅主题，QoS 固定 1 */
  topic: string;
  keepalive?: number;
  connectTimeout?: number;
  reconnectMinDelay?: number;
  reconnectMaxDelay?: number;
  authFailDelay?: number;
  /** 收到 PUBLISH：payload 已按 UTF-8 解码 */
  onMessage: (topic: string, payload: string) => void;
  /** 链路状态变化（面板据此渲染） */
  onStateChange?: (state: PushConnectionState, detail: string) => void;
  /** 连上并订阅成功（每次重连成功都会再触发一次，用于触发 HTTP 补漏） */
  onReady?: () => void;
}

// —— 字节工具：不依赖 TextEncoder / Buffer，老 WebView 也能跑 ——

/** UTF-8 编码（含代理对），非法代理项按 U+FFFD 处理 */
function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
    }
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    }
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        index += 1;
      }
      else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    }
    else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    }
    else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

/** UTF-8 解码 */
function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    index += 1;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    }
    else if (byte >= 0xc0 && byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[index] & 0x3f));
      index += 1;
    }
    else if (byte >= 0xe0 && byte < 0xf0) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[index] & 0x3f) << 6) | (bytes[index + 1] & 0x3f));
      index += 2;
    }
    else if (byte >= 0xf0) {
      const point
        = ((byte & 0x07) << 18) | ((bytes[index] & 0x3f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f);
      const value = point - 0x10000;
      out += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
      index += 3;
    }
    else {
      out += "\uFFFD";
    }
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    merged.set(part, offset);
    offset += part.length;
  });
  return merged;
}

/** 剩余长度：变长编码（每字节 7 位，最高位表示还有后续） */
function encodeRemainingLength(length: number): number[] {
  const bytes: number[] = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return bytes;
}

/** 读剩余长度；数据不完整返回 null（等下一帧补齐） */
function decodeRemainingLength(bytes: Uint8Array, start: number): { value: number; length: number } | null {
  let multiplier = 1;
  let value = 0;
  let index = start;
  while (index < bytes.length) {
    const byte = bytes[index];
    index += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, length: index - start };
    multiplier *= 128;
    if (multiplier > 128 ** 3) return null;
  }
  return null;
}

/** MQTT 字符串：2 字节长度 + UTF-8 */
function encodeString(value: string): Uint8Array {
  const body = utf8Encode(value);
  return concatBytes(new Uint8Array([(body.length >> 8) & 0xff, body.length & 0xff]), body);
}

/** 固定头 + 剩余长度 + 报文体 */
function buildPacket(header: number, body: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([header, ...encodeRemainingLength(body.length)]), body);
}

type SocketPayload = ArrayBuffer | ArrayBufferView | Blob | string | null;

export class MqttPushClient {
  private readonly options: Required<
    Pick<MqttPushClientOptions, "keepalive" | "connectTimeout" | "reconnectMinDelay" | "reconnectMaxDelay" | "authFailDelay">
  > & MqttPushClientOptions;

  private socket: WebSocket | null = null;
  /** 半包缓存：WebSocket 帧不保证对应完整 MQTT 报文 */
  private rx = new Uint8Array(0);
  private state: PushConnectionState = "idle";
  private detail = "";
  private stopped = true;
  /** 连续失败次数，用于指数退避 */
  private attempt = 0;
  /** 报文标识符（SUBSCRIBE 用），循环 1..65535 */
  private packetId = 1;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 已发 PINGREQ 但还没收到 PINGRESP */
  private pingPending = false;

  constructor(options: MqttPushClientOptions) {
    this.options = {
      keepalive: PUSH_KEEPALIVE_SECONDS,
      connectTimeout: PUSH_CONNECT_TIMEOUT_MS,
      reconnectMinDelay: PUSH_RECONNECT_MIN_DELAY_MS,
      reconnectMaxDelay: PUSH_RECONNECT_MAX_DELAY_MS,
      authFailDelay: PUSH_AUTH_FAIL_DELAY_MS,
      ...options,
    };
  }

  get currentState() {
    return this.state;
  }

  get currentDetail() {
    return this.detail;
  }

  /** 开始连接；已启动时重复调用无效 */
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.openSocket();
  }

  /** 主动断开：不再自动重连（服务端按会话有效期自行清理） */
  stop() {
    this.stopped = true;
    this.clearRetry();
    this.clearConnectTimer();
    this.stopHeartbeat();
    this.sendPacket(new Uint8Array([PACKET_DISCONNECT, 0x00]));
    this.closeSocket();
    this.setState("idle", "");
  }

  // —— 状态与定时器 ——

  private setState(state: PushConnectionState, detail = "") {
    this.state = state;
    this.detail = detail;
    this.options.onStateChange?.(state, detail);
  }

  private clearRetry() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearConnectTimer() {
    if (!this.connectTimer) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.pingPending = false;
  }

  private scheduleReconnect(delay: number) {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openSocket();
    }, Math.max(0, delay));
  }

  /** 普通掉线的指数退避：3s → 6s → 12s → … → 60s */
  private nextBackoffDelay() {
    const { reconnectMinDelay, reconnectMaxDelay } = this.options;
    return Math.min(reconnectMaxDelay, reconnectMinDelay * 2 ** Math.min(this.attempt, 5));
  }

  /** 失败收尾：清定时器、关 socket、切状态、排重连（认证失败传 authFailDelay） */
  private failConnection(delay: number, state?: PushConnectionState, detail?: string) {
    this.clearConnectTimer();
    this.stopHeartbeat();
    this.closeSocket();
    if (this.stopped) return;
    if (state) this.setState(state, detail || "");
    this.attempt += 1;
    this.scheduleReconnect(delay);
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.rx = new Uint8Array(0);
    this.pingPending = false;
    if (!socket) return;
    // 先摘监听：主动关闭不能再触发一次重连流程
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    }
    catch (error) {
      logger.debug("关闭 WebSocket 异常", error);
    }
  }

  // —— 连接 ——

  private openSocket() {
    if (this.stopped) return;

    if (typeof WebSocket === "undefined") {
      // 老 WebView / 非 H5 环境：明确报错，不空转重连
      logger.error("当前环境不支持 WebSocket，推送不可用");
      this.setState("failed", "当前环境不支持 WebSocket");
      return;
    }

    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    this.rx = new Uint8Array(0);
    this.pingPending = false;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url, WS_SUBPROTOCOL);
    }
    catch (error) {
      logger.error("创建 WebSocket 失败", error);
      this.failConnection(this.nextBackoffDelay(), "failed", "创建 WebSocket 失败");
      return;
    }

    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      logger.debug("WebSocket 已建立，发送 CONNECT");
      this.sendPacket(this.buildConnectPacket());
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.handleSocketPayload(event.data as SocketPayload);
    };

    socket.onerror = (event: Event) => {
      // onerror 之后 WebView 一定会给 onclose，重连交给 onclose 统一处理
      logger.warn("WebSocket 错误", event);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rx = new Uint8Array(0);
      this.clearConnectTimer();
      this.stopHeartbeat();
      if (this.stopped) return;
      this.setState("reconnecting");
      this.attempt += 1;
      this.scheduleReconnect(this.nextBackoffDelay());
    };

    // 握手 + CONNACK 的总超时
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.state === "connected") return;
      logger.warn("连接超时", this.options.url);
      this.failConnection(this.nextBackoffDelay(), "failed", "连接超时");
    }, this.options.connectTimeout);
  }

  private sendPacket(bytes: Uint8Array) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    catch (error) {
      logger.warn("发送 MQTT 报文失败", error);
    }
  }

  /** CONNECT：协议 4.1 的 Client ID / 用户名 / 口令、Keep Alive 30s、Clean Session = false */
  private buildConnectPacket(): Uint8Array {
    const { clientId, username, password, keepalive } = this.options;

    let flags = 0;
    const payloadParts: Uint8Array[] = [encodeString(clientId)];
    if (username) {
      flags |= 0x80;
      payloadParts.push(encodeString(username));
    }
    if (password) {
      flags |= 0x40;
      payloadParts.push(encodeString(password));
    }
    // 第 1 位保持 0：Clean Session = false，服务端保留订阅与未确认消息

    const variableHeader = concatBytes(
      encodeString(PROTOCOL_NAME),
      new Uint8Array([PROTOCOL_LEVEL, flags, (keepalive >> 8) & 0xff, keepalive & 0xff]),
    );
    return buildPacket(PACKET_CONNECT, concatBytes(variableHeader, ...payloadParts));
  }

  private nextPacketId() {
    this.packetId = this.packetId >= 0xffff ? 1 : this.packetId + 1;
    return this.packetId;
  }

  /** SUBSCRIBE：协议 4.3 的 topic，QoS 1 */
  private sendSubscribe() {
    const packetId = this.nextPacketId();
    const body = concatBytes(new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]), encodeString(this.options.topic), new Uint8Array([1]));
    this.sendPacket(buildPacket(PACKET_SUBSCRIBE, body));
    logger.debug("发送 SUBSCRIBE", this.options.topic, packetId);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const interval = Math.max(5, this.options.keepalive) * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (this.pingPending) {
        // 协议 4.1 的 Keep Alive：一个周期内没有 PINGRESP，说明链路已经不可用
        logger.warn("心跳超时，重连");
        this.failConnection(this.nextBackoffDelay(), "reconnecting");
        return;
      }
      this.pingPending = true;
      this.sendPacket(new Uint8Array([PACKET_PINGREQ, 0x00]));
    }, interval);
  }

  // —— 收报文 ——

  private handleSocketPayload(payload: SocketPayload) {
    if (!payload) return;
    if (typeof payload === "string") {
      // 二进制帧被当成文本：无法还原字节，只能丢弃这一帧
      logger.warn("收到文本帧，忽略");
      return;
    }
    if (payload instanceof ArrayBuffer) {
      this.appendChunk(new Uint8Array(payload));
      return;
    }
    if (ArrayBuffer.isView(payload)) {
      this.appendChunk(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength));
      return;
    }
    // 少数 WebView 忽略 binaryType，仍给 Blob
    if (typeof Blob !== "undefined" && payload instanceof Blob) {
      if (typeof payload.arrayBuffer === "function") {
        void payload.arrayBuffer().then((buffer: ArrayBuffer) => this.appendChunk(new Uint8Array(buffer)));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) this.appendChunk(new Uint8Array(reader.result));
      };
      reader.readAsArrayBuffer(payload);
    }
  }

  private appendChunk(chunk: Uint8Array) {
    this.rx = this.rx.length ? concatBytes(this.rx, chunk) : chunk;
    this.drainPackets();
  }

  /** 按「固定头 + 剩余长度」切包，可能一帧里有多个报文，也可能跨帧 */
  private drainPackets() {
    while (this.rx.length >= 2) {
      const remaining = decodeRemainingLength(this.rx, 1);
      if (!remaining) return;
      const headerLength = 1 + remaining.length;
      const total = headerLength + remaining.value;
      if (this.rx.length < total) return;

      const packet = this.rx.slice(0, total);
      this.rx = this.rx.slice(total);
      try {
        this.handlePacket(packet);
      }
      catch (error) {
        logger.error("解析 MQTT 报文失败", error);
      }
    }
  }

  private handlePacket(packet: Uint8Array) {
    const type = packet[0] & 0xf0;
    switch (type) {
      case PACKET_CONNACK:
        this.handleConnack(packet);
        break;
      case PACKET_SUBACK:
        this.handleSuback(packet);
        break;
      case PACKET_PUBLISH:
        this.handlePublish(packet);
        break;
      case PACKET_PINGRESP:
        this.pingPending = false;
        break;
      default:
        // PUBACK 等其余报文一期用不到，忽略
        break;
    }
  }

  private handleConnack(packet: Uint8Array) {
    // 固定头 2 字节 + Ack Flags + Return Code
    const returnCode = packet[3];
    if (returnCode === 0) {
      logger.info("MQTT 连接成功", { url: this.options.url, clientId: this.options.clientId });
      this.clearConnectTimer();
      this.attempt = 0;
      this.setState("connected");
      this.startHeartbeat();
      this.sendSubscribe();
      return;
    }

    if (returnCode === CONNACK_BAD_CREDENTIALS || returnCode === CONNACK_NOT_AUTHORIZED) {
      // 协议 4.2：用户名口令错误 / 未授权，不得高频重连，间隔不短于 5 分钟
      logger.error("MQTT 认证失败", returnCode);
      this.failConnection(this.options.authFailDelay, "unauthorized", "认证失败：用户名、口令或账号未开通");
      return;
    }

    logger.error("MQTT 连接被拒绝", returnCode);
    this.failConnection(this.nextBackoffDelay(), "failed", `连接被拒绝（返回码 ${returnCode}）`);
  }

  private handleSuback(packet: Uint8Array) {
    // 固定头 2 字节 + 报文标识符 2 字节 + 返回码
    const codes = packet.slice(4);
    if (!codes.length) return;

    if (codes.some(code => (code & 0xff) === SUBACK_FAILURE)) {
      // 协议 4.3：订阅其它设备号 / 通配符会被拒绝（SUBACK 0x80）
      logger.error("订阅被拒绝", this.options.topic);
      this.failConnection(this.options.authFailDelay, "unauthorized", "订阅被拒绝：请检查设备号是否与自己一致");
      return;
    }

    logger.info("订阅成功", this.options.topic);
    this.options.onReady?.();
  }

  private handlePublish(packet: Uint8Array) {
    const qos = (packet[0] >> 1) & 0x03;
    const remaining = decodeRemainingLength(packet, 1);
    if (!remaining) return;

    let offset = 1 + remaining.length;
    const topicLength = (packet[offset] << 8) | packet[offset + 1];
    offset += 2;
    if (offset + topicLength > packet.length) return;

    const topic = utf8Decode(packet.slice(offset, offset + topicLength));
    offset += topicLength;

    let packetId = 0;
    if (qos > 0) {
      packetId = (packet[offset] << 8) | packet[offset + 1];
      offset += 2;
    }

    const payload = utf8Decode(packet.slice(offset));

    // QoS 1：先回 PUBACK 再交给业务，避免处理耗时把重传拖出来
    if (qos === 1 && packetId > 0) {
      this.sendPacket(buildPacket(PACKET_PUBACK, new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])));
    }

    this.options.onMessage(topic, payload);
  }
}
