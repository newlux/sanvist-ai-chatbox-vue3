export interface AlipayStreamOptions {
  url: string;
  data: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  onMessage: (payload: unknown) => void;
}

export interface AlipayStreamTask {
  abort: () => void;
  done: Promise<void>;
}

interface ChunkedRequestTask {
  abort: () => void;
  onChunkReceived?: (callback: (result: { data: ArrayBuffer }) => void) => void;
}

function createUtf8Decoder() {
  let pending: number[] = [];

  return (data: ArrayBuffer) => {
    const bytes = [...pending, ...new Uint8Array(data)];
    const codePoints: number[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const first = bytes[offset];
      const length = first < 0x80 ? 1 : first < 0xE0 ? 2 : first < 0xF0 ? 3 : 4;
      if (offset + length > bytes.length) break;
      if (length === 1) {
        codePoints.push(first);
      }
      else if (length === 2) {
        codePoints.push(((first & 0x1F) << 6) | (bytes[offset + 1] & 0x3F));
      }
      else if (length === 3) {
        codePoints.push(
          ((first & 0x0F) << 12)
          | ((bytes[offset + 1] & 0x3F) << 6)
          | (bytes[offset + 2] & 0x3F),
        );
      }
      else {
        codePoints.push(
          ((first & 0x07) << 18)
          | ((bytes[offset + 1] & 0x3F) << 12)
          | ((bytes[offset + 2] & 0x3F) << 6)
          | (bytes[offset + 3] & 0x3F),
        );
      }
      offset += length;
    }
    pending = bytes.slice(offset);
    return String.fromCodePoint(...codePoints);
  };
}

function createSseConsumer(onMessage: (payload: unknown) => void) {
  let buffer = "";

  function consumeEvent(event: string) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      onMessage(JSON.parse(data));
    }
    catch {
      onMessage(data);
    }
  }

  return {
    push(text: string) {
      buffer += text;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      events.forEach(consumeEvent);
    },
    flush() {
      if (buffer.trim()) consumeEvent(buffer);
      buffer = "";
    },
  };
}

export function createAlipaySseRequest(options: AlipayStreamOptions): AlipayStreamTask {
  let requestTask: ChunkedRequestTask | undefined;
  let settled = false;
  let rejectDone: (reason?: unknown) => void = () => {};
  const decodeChunk = createUtf8Decoder();
  const consumer = createSseConsumer(options.onMessage);

  const done = new Promise<void>((resolve, reject) => {
    rejectDone = reject;
    const requestWithTask = uni.request as unknown as (
      options: UniApp.RequestOptions,
    ) => ChunkedRequestTask;
    requestTask = requestWithTask({
      url: options.url,
      method: "POST",
      data: options.data,
      header: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...options.headers,
      },
      timeout: options.timeout ?? 120_000,
      enableChunked: true,
      success(response) {
        if (settled) return;
        settled = true;
        consumer.flush();
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) resolve();
        else reject(new Error(`流式请求失败（${statusCode}）`));
      },
      fail(error) {
        if (settled) return;
        settled = true;
        const message = error.errMsg || "流式请求失败";
        const normalized = new Error(message);
        if (/\babort\b|取消/i.test(message)) normalized.name = "AbortError";
        reject(normalized);
      },
    } as UniApp.RequestOptions);

    if (typeof requestTask.onChunkReceived !== "function") {
      requestTask.abort();
      settled = true;
      reject(new Error("当前支付宝小程序运行环境不支持 HTTP 分块响应，请切换 WebSocket 流式协议"));
      return;
    }

    requestTask.onChunkReceived(({ data }) => {
      consumer.push(decodeChunk(data));
    });
  });

  return {
    abort() {
      if (settled) return;
      settled = true;
      requestTask?.abort();
      const error = new Error("请求已取消");
      error.name = "AbortError";
      rejectDone(error);
    },
    done,
  };
}
