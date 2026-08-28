import type { PlayListenBroadcastParams } from "./types";
import { createSseSession } from "@/utils/ai-stream";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

export interface ListenBroadcastStreamHandle {
  cancel: () => void;
}

export function consumeListenBroadcastStream(
  params: PlayListenBroadcastParams,
  onEvent: (payload: unknown) => void,
  onError: (error: Error) => void,
  onClose: () => void,
): ListenBroadcastStreamHandle {
  const controller = new AbortController();
  const url = `${getRequestBaseURL().replace(/\/$/, "")}/listen-broadcast/play`;
  const session = createSseSession({
    onEvent,
    isAborted: () => controller.signal.aborted,
  });

  void (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getRequestHeaders({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`听播播报失败（${response.status}）`);

      if (!response.body) {
        session.finalize(await response.text());
        onClose();
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) session.consumeChunk(value);
      }
      session.finalize();
      onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        onClose();
        return;
      }
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { cancel: () => controller.abort() };
}
