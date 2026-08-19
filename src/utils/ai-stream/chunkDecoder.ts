/**
 * 流式 UTF-8 解码器。
 *
 * 分块传输会在任意字节位置切断，一个多字节汉字可能跨两个 chunk。
 * 必须保留尾部不完整的字节序列，等下一个 chunk 到达后再拼接解码，
 * 否则流式文本里会出现乱码方块。
 */

/** fetch 的 reader 给的是 Uint8Array 视图，小程序 onChunkReceived 给的是 ArrayBuffer */
export type ChunkData = ArrayBuffer | ArrayBufferView;

export interface ChunkDecoder {
  decode: (data: ChunkData) => string;
  flush: () => string;
}

function toBytes(data: ChunkData) {
  if (ArrayBuffer.isView(data)) {
    // 视图可能只覆盖底层 buffer 的一段，不能直接用 data.buffer
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

// 一次 fromCodePoint 的参数上限，避免超长 chunk 撑爆调用栈
const CODE_POINT_BATCH = 4096;

function codePointsToString(codePoints: number[]) {
  if (codePoints.length <= CODE_POINT_BATCH) {
    return String.fromCodePoint(...codePoints);
  }
  let text = "";
  for (let offset = 0; offset < codePoints.length; offset += CODE_POINT_BATCH) {
    text += String.fromCodePoint(...codePoints.slice(offset, offset + CODE_POINT_BATCH));
  }
  return text;
}

function createManualDecoder(): ChunkDecoder {
  let pending: number[] = [];

  return {
    decode(data: ChunkData) {
      const incoming = toBytes(data);
      const bytes = pending.length ? [...pending, ...incoming] : [...incoming];
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
      return codePointsToString(codePoints);
    },
    flush() {
      pending = [];
      return "";
    },
  };
}

export function createChunkDecoder(): ChunkDecoder {
  if (typeof TextDecoder !== "undefined") {
    const decoder = new TextDecoder("utf-8");
    return {
      decode: (data: ChunkData) => decoder.decode(data as BufferSource, { stream: true }),
      flush: () => decoder.decode(),
    };
  }
  // 部分小程序基础库没有 TextDecoder
  return createManualDecoder();
}
