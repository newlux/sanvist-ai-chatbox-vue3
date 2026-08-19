interface PosterMessage {
  role?: string;
  content?: string;
  blocks?: Array<{
    type?: string;
    payload?: { content?: string };
  }>;
}

function getMessageText(message: PosterMessage) {
  const direct = String(message.content || "").trim();
  if (direct) return direct;
  return (message.blocks || [])
    .filter(block => block.type === "answer")
    .map(block => String(block.payload?.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function wrapText(text: string, maxChars: number) {
  const lines: string[] = [];
  String(text || "").split("\n").forEach((paragraph) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    for (let offset = 0; offset < paragraph.length; offset += maxChars) {
      lines.push(paragraph.slice(offset, offset + maxChars));
    }
  });
  return lines;
}

export function createAlipayConversationPoster(messages: PosterMessage[]): Promise<string> {
  const width = 620;
  const padding = 36;
  const contentWidth = width - padding * 2;
  const lineHeight = 34;
  const maxChars = 24;
  const sections = messages.map(message => ({
    role: message.role === "user" ? "我" : "AI 助手",
    lines: wrapText(getMessageText(message), maxChars),
  })).filter(section => section.lines.some(Boolean));
  const height = Math.min(
    4000,
    150 + sections.reduce((total, section) => total + 64 + section.lines.length * lineHeight, 0),
  );
  const canvasId = "alipay-share-poster-canvas";
  const context = uni.createCanvasContext(canvasId);

  context.setFillStyle("#ffffff");
  context.fillRect(0, 0, width, height);
  context.setFillStyle("#1a1a1a");
  context.setFontSize(28);
  context.fillText("三一智能问答", padding, 52);
  context.setFillStyle("#999999");
  context.setFontSize(18);
  context.fillText(new Date().toLocaleDateString(), padding, 84);

  let y = 126;
  sections.forEach((section) => {
    context.setFillStyle(section.role === "我" ? "#da291c" : "#333333");
    context.setFontSize(22);
    context.fillText(section.role, padding, y);
    y += 38;
    context.setFillStyle("#333333");
    context.setFontSize(20);
    section.lines.forEach((line) => {
      if (y > height - padding) return;
      context.fillText(line, padding, y, contentWidth);
      y += lineHeight;
    });
    y += 24;
  });

  return new Promise((resolve, reject) => {
    context.draw(false, () => {
      uni.canvasToTempFilePath({
        canvasId,
        width,
        height,
        destWidth: width * 2,
        destHeight: height * 2,
        fileType: "png",
        quality: 1,
        success: result => resolve(result.tempFilePath),
        fail: reject,
      });
    });
  });
}

export function savePosterToAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: reject,
    });
  });
}
