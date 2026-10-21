/**
 * 极简二维码编码器：byte 模式 + 纠错等级 M，按内容长度自动选择版本 1-10（最多 213 字节）。
 *
 * mPaaS 离线包对体积敏感，且这里只需要「把一段文本画成二维码」这一个能力，
 * 所以不引第三方库，按 ISO/IEC 18004 自己完成编码、纠错与排版。
 *
 * 用法：`const { size, modules } = encodeQrCode(text)`，modules[row][col] 为 true 即深色模块，
 * 渲染时应自行补 4 个模块的静默区（白边）。
 */

/** 一个版本在纠错等级 M 下的排版参数 */
interface QrVersionSpec {
  /** 每个 RS 分块承载的数据码字数（按块顺序，同一版本内各块至多相差 1） */
  dataCodewords: number[];
  /** 每个分块的纠错码字数 */
  ecPerBlock: number;
  /** 对齐图案中心坐标 */
  alignmentCenters: number[];
}

const VERSIONS: QrVersionSpec[] = [
  { dataCodewords: [16], ecPerBlock: 10, alignmentCenters: [] },
  { dataCodewords: [28], ecPerBlock: 16, alignmentCenters: [6, 18] },
  { dataCodewords: [44], ecPerBlock: 26, alignmentCenters: [6, 22] },
  { dataCodewords: [32, 32], ecPerBlock: 18, alignmentCenters: [6, 26] },
  { dataCodewords: [43, 43], ecPerBlock: 24, alignmentCenters: [6, 30] },
  { dataCodewords: [27, 27, 27, 27], ecPerBlock: 16, alignmentCenters: [6, 34] },
  { dataCodewords: [31, 31, 31, 31], ecPerBlock: 18, alignmentCenters: [6, 22, 38] },
  { dataCodewords: [19, 19, 20, 20], ecPerBlock: 22, alignmentCenters: [6, 24, 42] },
  { dataCodewords: [36, 36, 36, 37, 37], ecPerBlock: 22, alignmentCenters: [6, 26, 46] },
  { dataCodewords: [43, 43, 43, 43, 44], ecPerBlock: 26, alignmentCenters: [6, 28, 50] },
];

/** 模式指示符：byte（8 位字节） */
const MODE_BYTE = 0b0100;
/** 纠错等级 M 在格式信息里的 2 bit 取值 */
const EC_LEVEL_M = 0b00;

export interface QrCodeMatrix {
  /** 边长（模块数），不含静默区 */
  size: number;
  /** 选中的版本号（1-10） */
  version: number;
  /** 选中的掩码编号（0-7） */
  mask: number;
  /** modules[row][col] === true 表示深色模块 */
  modules: boolean[][];
}

/* ---------------- GF(256) 运算（本原多项式 0x11D） ---------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11D;
  }
  // 乘幂表补一倍长度，乘法时直接相加不用再取模
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255];
})();

function gfMultiply(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 生成多项式 ∏(x - α^i)，系数按降幂排列，首项恒为 1 */
function buildGeneratorPolynomial(degree: number) {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let term = 0; term < polynomial.length; term += 1) {
      next[term] ^= polynomial[term];
      next[term + 1] ^= gfMultiply(polynomial[term], GF_EXP[index]);
    }
    polynomial = next;
  }
  return polynomial;
}

const generatorCache = new Map<number, number[]>();

function getGeneratorPolynomial(degree: number) {
  const cached = generatorCache.get(degree);
  if (cached) return cached;
  const polynomial = buildGeneratorPolynomial(degree);
  generatorCache.set(degree, polynomial);
  return polynomial;
}

/** Reed-Solomon 余式即为纠错码字 */
function computeEccCodewords(data: number[], ecCount: number) {
  const generator = getGeneratorPolynomial(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);
  for (const codeword of data) {
    const factor = codeword ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor === 0) continue;
    for (let index = 0; index < ecCount; index += 1) {
      remainder[index] ^= gfMultiply(generator[index + 1], factor);
    }
  }
  return remainder;
}

/* ---------------- 文本 → 数据码字 ---------------- */

function toUtf8Bytes(text: string) {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    // 代理对拼成一个码点
    if (codePoint >= 0xD800 && codePoint <= 0xDBFF && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        codePoint = (codePoint - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    }
    else if (codePoint < 0x800) {
      bytes.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F));
    }
    else if (codePoint < 0x10000) {
      bytes.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
    }
    else {
      bytes.push(
        0xF0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3F),
        0x80 | ((codePoint >> 6) & 0x3F),
        0x80 | (codePoint & 0x3F),
      );
    }
  }
  return bytes;
}

/** 字符计数指示符位宽：版本 1-9 用 8 位，10-26 用 16 位 */
function characterCountBits(version: number) {
  return version < 10 ? 8 : 16;
}

function dataCapacity(spec: QrVersionSpec, version: number) {
  const dataBits = spec.dataCodewords.reduce((sum, count) => sum + count, 0) * 8;
  return Math.floor((dataBits - 4 - characterCountBits(version)) / 8);
}

function buildDataCodewords(bytes: number[], spec: QrVersionSpec, version: number) {
  const bits: number[] = [];
  const pushBits = (value: number, length: number) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  };

  pushBits(MODE_BYTE, 4);
  pushBits(bytes.length, characterCountBits(version));
  bytes.forEach(byte => pushBits(byte, 8));

  // 结束符 0000（放不下就截断）与补齐到字节边界
  const capacityBits = spec.dataCodewords.reduce((sum, count) => sum + count, 0) * 8;
  for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let codeword = 0;
    for (let bit = 0; bit < 8; bit += 1) codeword = (codeword << 1) | bits[index + bit];
    codewords.push(codeword);
  }
  // 交替填充 0xEC / 0x11
  for (let index = 0; codewords.length < capacityBits / 8; index += 1) {
    codewords.push(index % 2 === 0 ? 0xEC : 0x11);
  }
  return codewords;
}

/** 按 RS 分块算纠错码字，再按「数据交叉 + 纠错交叉」拼成最终码字序列 */
function buildFinalCodewords(dataCodewords: number[], spec: QrVersionSpec) {
  const blocks: { data: number[]; ecc: number[] }[] = [];
  let offset = 0;
  for (const size of spec.dataCodewords) {
    const data = dataCodewords.slice(offset, offset + size);
    offset += size;
    blocks.push({ data, ecc: computeEccCodewords(data, spec.ecPerBlock) });
  }

  const final: number[] = [];
  const maxDataLength = Math.max(...spec.dataCodewords);
  for (let index = 0; index < maxDataLength; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) final.push(block.data[index]);
    }
  }
  for (let index = 0; index < spec.ecPerBlock; index += 1) {
    for (const block of blocks) final.push(block.ecc[index]);
  }
  return final;
}

/* ---------------- 矩阵排版 ---------------- */

const MASK_FUNCTIONS = [
  (row: number, col: number) => (row + col) % 2 === 0,
  (row: number) => row % 2 === 0,
  (_row: number, col: number) => col % 3 === 0,
  (row: number, col: number) => (row + col) % 3 === 0,
  (row: number, col: number) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row: number, col: number) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row: number, col: number) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row: number, col: number) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

function createGrid(size: number) {
  return Array.from({ length: size }, () => new Array<number>(size).fill(0));
}

/** 定位图案（含分隔符） */
function placeFinderPattern(modules: number[][], isFunction: boolean[][], row: number, col: number) {
  const size = modules.length;
  for (let offsetRow = -1; offsetRow <= 7; offsetRow += 1) {
    for (let offsetCol = -1; offsetCol <= 7; offsetCol += 1) {
      const targetRow = row + offsetRow;
      const targetCol = col + offsetCol;
      if (targetRow < 0 || targetRow >= size || targetCol < 0 || targetCol >= size) continue;
      const ring = offsetRow >= 0 && offsetRow <= 6 && (offsetCol === 0 || offsetCol === 6);
      const bar = offsetCol >= 0 && offsetCol <= 6 && (offsetRow === 0 || offsetRow === 6);
      const core = offsetRow >= 2 && offsetRow <= 4 && offsetCol >= 2 && offsetCol <= 4;
      modules[targetRow][targetCol] = ring || bar || core ? 1 : 0;
      isFunction[targetRow][targetCol] = true;
    }
  }
}

/** 对齐图案：中心 3×3 实心 + 一圈白 + 一圈黑边 */
function placeAlignmentPattern(modules: number[][], isFunction: boolean[][], row: number, col: number) {
  for (let offsetRow = -2; offsetRow <= 2; offsetRow += 1) {
    for (let offsetCol = -2; offsetCol <= 2; offsetCol += 1) {
      const distance = Math.max(Math.abs(offsetRow), Math.abs(offsetCol));
      modules[row + offsetRow][col + offsetCol] = distance === 1 ? 0 : 1;
      isFunction[row + offsetRow][col + offsetCol] = true;
    }
  }
}

/** 格式信息的 15 bit（BCH(15,5) + 固定掩模 0x5412） */
function formatInfoBits(mask: number) {
  const data = (EC_LEVEL_M << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/** 版本信息的 18 bit（BCH(18,6)，仅版本 ≥ 7 使用） */
function versionInfoBits(version: number) {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25);
  }
  return (version << 12) | remainder;
}

function placeDataBits(modules: number[][], isFunction: boolean[][], codewords: number[], mask: number) {
  const size = modules.length;
  const maskFn = MASK_FUNCTIONS[mask];
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    // 跳过第 6 列（竖向定位图案）
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      for (let column = 0; column < 2; column += 1) {
        const col = right - column;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - step : step;
        if (isFunction[row][col]) continue;
        const bit = bitIndex < totalBits ? (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1 : 0;
        bitIndex += 1;
        modules[row][col] = maskFn(row, col) ? bit ^ 1 : bit;
      }
    }
  }
}

/** 掩码评分（ISO 的四条罚分规则），分数越低越好 */
function evaluatePenalty(modules: number[][]) {
  const size = modules.length;
  let penalty = 0;

  // 规则 1：同色连续 5 个以上
  const countRunPenalty = (get: (index: number) => number, length: number) => {
    let runColor = get(0);
    let runLength = 1;
    let score = 0;
    for (let index = 1; index < length; index += 1) {
      const color = get(index);
      if (color === runColor) {
        runLength += 1;
        continue;
      }
      if (runLength >= 5) score += runLength - 2;
      runColor = color;
      runLength = 1;
    }
    if (runLength >= 5) score += runLength - 2;
    return score;
  };
  for (let row = 0; row < size; row += 1) {
    penalty += countRunPenalty(col => modules[row][col], size) * 3;
  }
  for (let col = 0; col < size; col += 1) {
    penalty += countRunPenalty(row => modules[row][col], size) * 3;
  }

  // 规则 2：2×2 同色块
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const color = modules[row][col];
      if (color === modules[row][col + 1] && color === modules[row + 1][col] && color === modules[row + 1][col + 1]) {
        penalty += 3;
      }
    }
  }

  // 规则 3：形似定位图案的 1:1:3:1:1（前后各留 4 个浅色）
  const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const matchesFinderLike = (get: (index: number) => number, start: number, reverse: boolean) => {
    for (let index = 0; index < FINDER_LIKE.length; index += 1) {
      const expected = reverse ? FINDER_LIKE[FINDER_LIKE.length - 1 - index] : FINDER_LIKE[index];
      if (get(start + index) !== expected) return false;
    }
    return true;
  };
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col <= size - FINDER_LIKE.length; col += 1) {
      if (matchesFinderLike(offset => modules[row][col + offset], 0, false)) penalty += 40;
      if (matchesFinderLike(offset => modules[row][col + offset], 0, true)) penalty += 40;
    }
  }
  for (let col = 0; col < size; col += 1) {
    for (let row = 0; row <= size - FINDER_LIKE.length; row += 1) {
      if (matchesFinderLike(offset => modules[row + offset][col], 0, false)) penalty += 40;
      if (matchesFinderLike(offset => modules[row + offset][col], 0, true)) penalty += 40;
    }
  }

  // 规则 4：深浅比例偏离 50%
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) dark += modules[row][col];
  }
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

function buildMatrix(version: number, spec: QrVersionSpec, codewords: number[]) {
  const size = version * 4 + 17;

  function render(mask: number) {
    const modules = createGrid(size);
    // 每个掩码都要重画一遍功能图形：复用同一份 isFunction 会让时序图案在第二轮之后被跳过
    const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    placeFinderPattern(modules, isFunction, 0, 0);
    placeFinderPattern(modules, isFunction, 0, size - 7);
    placeFinderPattern(modules, isFunction, size - 7, 0);

    // 定位图案（第 6 行 / 第 6 列），只在还没被占用的格子上画
    for (let index = 0; index < size; index += 1) {
      if (!isFunction[6][index]) {
        modules[6][index] = index % 2 === 0 ? 1 : 0;
        isFunction[6][index] = true;
      }
      if (!isFunction[index][6]) {
        modules[index][6] = index % 2 === 0 ? 1 : 0;
        isFunction[index][6] = true;
      }
    }

    for (const row of spec.alignmentCenters) {
      for (const col of spec.alignmentCenters) {
        const nearTopLeft = row <= 8 && col <= 8;
        const nearTopRight = row <= 8 && col >= size - 9;
        const nearBottomLeft = row >= size - 9 && col <= 8;
        if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
        placeAlignmentPattern(modules, isFunction, row, col);
      }
    }

    // 预留格式信息区（版本 ≥ 7 还要预留版本信息区）
    for (let index = 0; index <= 8; index += 1) {
      isFunction[8][index] = true;
      isFunction[index][8] = true;
    }
    for (let index = 0; index < 8; index += 1) {
      isFunction[8][size - 1 - index] = true;
      isFunction[size - 1 - index][8] = true;
    }
    if (version >= 7) {
      for (let index = 0; index < 6; index += 1) {
        for (let offset = 0; offset < 3; offset += 1) {
          isFunction[size - 11 + offset][index] = true;
          isFunction[index][size - 11 + offset] = true;
        }
      }
    }

    placeDataBits(modules, isFunction, codewords, mask);

    // 固定深模块
    modules[size - 8][8] = 1;

    const formatBits = formatInfoBits(mask);
    const formatBit = (index: number) => (formatBits >>> index) & 1;
    for (let index = 0; index <= 5; index += 1) modules[index][8] = formatBit(index);
    modules[7][8] = formatBit(6);
    modules[8][8] = formatBit(7);
    modules[8][7] = formatBit(8);
    for (let index = 9; index < 15; index += 1) modules[8][14 - index] = formatBit(index);
    for (let index = 0; index < 8; index += 1) modules[8][size - 1 - index] = formatBit(index);
    for (let index = 8; index < 15; index += 1) modules[size - 15 + index][8] = formatBit(index);

    if (version >= 7) {
      const versionBits = versionInfoBits(version);
      for (let index = 0; index < 18; index += 1) {
        const bit = (versionBits >>> index) & 1;
        const row = size - 11 + (index % 3);
        const col = Math.floor(index / 3);
        modules[row][col] = bit;
        modules[col][row] = bit;
      }
    }

    return modules;
  }

  let bestMask = 0;
  let bestModules = render(0);
  let bestPenalty = evaluatePenalty(bestModules);
  for (let mask = 1; mask < 8; mask += 1) {
    const modules = render(mask);
    const penalty = evaluatePenalty(modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestModules = modules;
      bestMask = mask;
    }
  }

  return {
    size,
    mask: bestMask,
    modules: bestModules.map(row => row.map(value => value === 1)),
  };
}

/**
 * 把文本编码成二维码矩阵。
 * 内容超过最大容量（版本 10 / 等级 M 的 213 字节）时抛错，调用方应提前截断或提示。
 */
export function encodeQrCode(text: string): QrCodeMatrix {
  const bytes = toUtf8Bytes(String(text || ""));
  let version = 0;
  let spec: QrVersionSpec | null = null;
  for (let index = 0; index < VERSIONS.length; index += 1) {
    const candidate = VERSIONS[index];
    if (dataCapacity(candidate, index + 1) >= bytes.length) {
      version = index + 1;
      spec = candidate;
      break;
    }
  }
  if (!spec) throw new Error("qrcode content too long");

  const dataCodewords = buildDataCodewords(bytes, spec, version);
  const finalCodewords = buildFinalCodewords(dataCodewords, spec);
  const { size, mask, modules } = buildMatrix(version, spec, finalCodewords);
  return { size, version, mask, modules };
}
