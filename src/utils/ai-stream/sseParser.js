function parseEventData(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function parseJsonObjectStream(rawText) {
  const source = String(rawText || "");
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth) {
      depth -= 1;
      if (depth === 0) {
        const payload = parseEventData(source.slice(start, index + 1));
        if (payload) objects.push(payload);
        start = -1;
      }
    }
  }
  return objects;
}

function createBlock(type, payload, index) {
  return { id: `${type}-${index}`, type, payload, complete: true };
}

function suggestionFromContent(content) {
  const match = String(content || "").match(
    /<SUG+ESTION>([\s\S]*?)<\/SUG+ESTION>/i,
  );
  return match ? match[1].trim() : "";
}

export function parseHistoryBlocks(rawText) {
  const entries = parseJsonObjectStream(rawText);
  const lastToolCallIndex = entries.reduce(
    (lastIndex, entry, index) => (entry?.name ? index : lastIndex),
    -1,
  );

  return entries.reduce((blocks, entry, index) => {
    if (entry?.stage || entry?.name) {
      return blocks;
    } else if (entry?.type && entry?.option) {
      blocks.push(createBlock("chart", entry, blocks.length));
    } else if (Array.isArray(entry?.items)) {
      blocks.push(createBlock("suggestion", entry, blocks.length));
    } else if (typeof entry?.content === "string") {
      const suggestion = suggestionFromContent(entry.content);
      if (suggestion) {
        blocks.push(
          createBlock("suggestion", { items: [suggestion] }, blocks.length),
        );
      } else if (index >= lastToolCallIndex) {
        blocks.push(createBlock("answer", entry, blocks.length));
      }
    }
    return blocks;
  }, []);
}
