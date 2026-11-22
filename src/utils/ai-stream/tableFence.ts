import type { AiBlock } from "./chatStreamParser";

interface MarkdownTable {
  columns: string[];
  rows: string[][];
}

function splitRow(line: string) {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const character of source) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
    escaped = character === "\\" && !escaped;
  }
  cells.push(cell.trim());
  return cells.map(value => value.replace(/\\\|/g, "|"));
}

function parseMarkdownTable(lines: string[]): MarkdownTable | null {
  if (lines.length < 2) return null;
  const columns = splitRow(lines[0]);
  const separator = splitRow(lines[1]);
  const rows = lines.slice(2).map(splitRow);
  if (!columns.length || separator.length !== columns.length
    || !separator.every(cell => /^:?-{3,}:?$/.test(cell))
    || !rows.every(row => row.length === columns.length)) {
    return null;
  }
  return { columns, rows };
}

function isFence(line: string) {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}

/**
 * 已经作为结构化 table block 存在的内容快照（`<COMPONENT type="table">` 下发 / 历史解析出来的）。
 * 正文里同一张表再按 markdown 渲染一次就成了两张表，渲染时按这个集合吞掉。
 */
function tableKey(columns: unknown, rows: unknown) {
  return JSON.stringify([Array.isArray(columns) ? columns : [], Array.isArray(rows) ? rows : []]);
}

/**
 * 流式友好的表格识别：表头 + 分隔行合法就认成表格，后面逐行按列数往下吃；
 * 遇到列数不对的行就停（那是还没吐完的一行），把它留给正文，下一帧补齐后再并进表格。
 *
 * 不能用严格版 parseMarkdownTable 把整段「|」行一次性校验：流式时最后一行几乎总是半截，
 * 一校验失败整块表格就被判回正文 —— 正文里突然多出表格源码、表格块被卸载，
 * 下一帧又还原。用户看到的就是文字闪一下、表格上下跳。
 */
function parseStreamingTable(lines: string[], start: number): (MarkdownTable & { end: number }) | null {
  const columns = splitRow(lines[start] ?? "");
  const separator = splitRow(lines[start + 1] ?? "");
  if (!columns.length || separator.length !== columns.length
    || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }
  const rows: string[][] = [];
  let cursor = start + 2;
  while (cursor < lines.length && lines[cursor].includes("|")) {
    const cells = splitRow(lines[cursor]);
    if (cells.length !== columns.length) break;
    rows.push(cells);
    cursor += 1;
  }
  return { columns, rows, end: cursor };
}

function expandAnswerBlock(block: AiBlock, seen: Set<string>): AiBlock[] {
  const lines = String(block.payload.content || "").split(/\r?\n/);
  const pieces: AiBlock[] = [];
  const textLines: string[] = [];
  let codeFence = false;
  /** 正文片 / 表格片各自的序号：分开计数，表格片被吞掉（重复下发）时正文片 id 不会跟着挪 */
  let textCount = 0;
  let tableCount = 0;
  /** 是否吞掉过「已经以结构化块下发过的表」——正文只有这张表时才需要连 answer 块一起丢掉 */
  let droppedTable = false;

  function appendText() {
    const content = textLines.join("\n");
    textLines.length = 0;
    if (!content.trim()) return;
    pieces.push({
      ...block,
      // 第一段正文沿用原块 id：同一段正文在「还没成表格 / 已拆出表格」两种形态下 id 不变，
      // Vue 才会复用同一个 AnswerBlock，打字机进度不会归零重打
      id: textCount === 0 ? block.id : `${block.id}-text-${textCount}`,
      // payload 要整份带上：complete / replayed 等标记不能在这里丢掉
      payload: { ...block.payload, content },
    });
    textCount += 1;
  }

  let index = 0;
  while (index < lines.length) {
    if (isFence(lines[index])) {
      codeFence = !codeFence;
      textLines.push(lines[index]);
      index += 1;
      continue;
    }

    if (!codeFence && lines[index].includes("|") && lines[index + 1]?.includes("|")) {
      const table = parseStreamingTable(lines, index);
      if (table) {
        appendText();
        // 这张表已经以结构化 table block 下发过了：不再重复渲染一份
        if (seen.has(tableKey(table.columns, table.rows))) {
          droppedTable = true;
        }
        else {
          pieces.push({
            id: `${block.id}-table-${tableCount}`,
            type: "table",
            payload: table as unknown as Record<string, unknown>,
            complete: true,
          });
          tableCount += 1;
        }
        index = table.end;
        continue;
      }
    }

    textLines.push(lines[index]);
    index += 1;
  }

  appendText();
  if (pieces.length) return pieces;
  // 正文只有那张「已由结构化块渲染」的表：整块丢掉，否则 markdown 会把表格源码再画一遍
  return droppedTable ? [] : [block];
}

/** 将 answer 内所有有效 Markdown 表格转换为供 TableBlock 渲染的 table block。 */
export function expandMarkdownTables(blocks: AiBlock[]): AiBlock[] {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.some(block => block?.type === "answer" && String(block.payload?.content || "").includes("|"))) {
    return list;
  }

  // 已有的结构化表格先登记（协议块可能在正文前面也可能在后面），正文里重复的同一张表直接吞掉
  const seen = new Set<string>();
  list.forEach((block) => {
    if (block?.type === "table") seen.add(tableKey(block.payload?.columns, block.payload?.rows));
  });

  const expanded: AiBlock[] = [];
  let changed = false;
  list.forEach((block) => {
    if (block?.type !== "answer") {
      expanded.push(block);
      return;
    }
    const parts = expandAnswerBlock(block, seen);
    if (parts.length !== 1 || parts[0] !== block) changed = true;
    expanded.push(...parts);
  });
  return changed ? expanded : list;
}

/**
 * 摘掉回答正文里的 Markdown 表格（听播问答只念正文、不展示表格）。
 *
 * 判定逻辑与 expandMarkdownTables 完全一致 —— 首页认定为表格的内容，在这里会被整段摘掉，
 * 不会因为「首页是表格、听播是乱码竖线」而两端表现不一致。
 */
export function stripMarkdownTables(content: string): string {
  const source = String(content || "");
  if (!source.includes("|")) return source;

  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  let codeFence = false;
  let index = 0;

  while (index < lines.length) {
    if (isFence(lines[index])) {
      codeFence = !codeFence;
      kept.push(lines[index]);
      index += 1;
      continue;
    }

    if (!codeFence && lines[index].includes("|") && lines[index + 1]?.includes("|")) {
      let end = index + 2;
      while (end < lines.length && lines[end].includes("|")) end += 1;
      if (parseMarkdownTable(lines.slice(index, end))) {
        index = end;
        continue;
      }
    }

    kept.push(lines[index]);
    index += 1;
  }

  // 表格整段摘掉后可能留下连续空行，压成单个空行再收尾。
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
