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

function expandAnswerBlock(block: AiBlock): AiBlock[] {
  const lines = String(block.payload.content || "").split(/\r?\n/);
  const pieces: AiBlock[] = [];
  const textLines: string[] = [];
  let codeFence = false;

  function appendText() {
    const content = textLines.join("\n");
    textLines.length = 0;
    if (content.trim()) {
      pieces.push({
        ...block,
        id: `${block.id}-text-${pieces.length}`,
        payload: { content },
      });
    }
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
      let end = index + 2;
      while (end < lines.length && lines[end].includes("|")) end += 1;
      const table = parseMarkdownTable(lines.slice(index, end));
      if (table) {
        appendText();
        pieces.push({
          id: `${block.id}-table-${pieces.length}`,
          type: "table",
          payload: table as unknown as Record<string, unknown>,
          complete: true,
        });
        index = end;
        continue;
      }
    }

    textLines.push(lines[index]);
    index += 1;
  }

  appendText();
  return pieces.length ? pieces : [block];
}

/** 将 answer 内所有有效 Markdown 表格转换为供 TableBlock 渲染的 table block。 */
export function expandMarkdownTables(blocks: AiBlock[]): AiBlock[] {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.some(block => block?.type === "answer" && String(block.payload?.content || "").includes("|"))) {
    return list;
  }

  const expanded: AiBlock[] = [];
  let changed = false;
  list.forEach((block) => {
    if (block?.type !== "answer") {
      expanded.push(block);
      return;
    }
    const parts = expandAnswerBlock(block);
    if (parts.length !== 1 || parts[0] !== block) changed = true;
    expanded.push(...parts);
  });
  return changed ? expanded : list;
}
