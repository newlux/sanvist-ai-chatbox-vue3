import type { AsrStreamHandlers, AsrStreamSession } from './asr-stream-session';

interface Capture { stop: () => void | Promise<void> }
export interface DuplexState {
  active: boolean;
  starting: boolean;
  listening: boolean;
  transcript: string;
}
interface Dependencies {
  openSession: (handlers: AsrStreamHandlers) => AsrStreamSession;
  startCapture: (handlers: { isCurrent: () => boolean; onFrame: (frame: ArrayBuffer) => void; onLevel: (level: number) => void; onError: (message: string) => void }) => Promise<Capture>;
  submit: (text: string) => void;
  setGain: (gain: number) => void;
  onState: (state: DuplexState) => void;
  onError: (message: string) => void;
  now?: () => number;
}
interface Segment {
  session?: AsrStreamSession;
  finishing: boolean;
  done: boolean;
  text: string;
  partial: string;
  updatedAt: number;
  openedAt: number;
}

/** 持续持有麦克风；现有 ASR 为单次 final 协议，分句时轮换连接而不重开设备。 */
export function createDuplexVoiceRuntime(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  let generation = 0;
  let state: DuplexState = { active: false, starting: false, listening: false, transcript: '' };
  let capture: Capture | null = null;
  let pendingCapture: Promise<Capture> | null = null;
  let released: Promise<unknown> = Promise.resolve();
  let current: Segment | null = null;
  let segments: Segment[] = [];
  let tick: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let speechAt = -Infinity;
  let speechStart = 0;
  const emit = (patch: Partial<DuplexState>) => { state = { ...state, ...patch }; deps.onState({ ...state }); };

  function stop() {
    generation += 1;
    if (tick) clearInterval(tick);
    if (retry) clearTimeout(retry);
    tick = null;
    retry = null;
    const oldCapture = capture;
    capture = null;
    for (const item of segments) item.session?.close();
    segments = [];
    current = null;
    const pending = pendingCapture;
    pendingCapture = null;
    released = Promise.all([released.catch(() => {}), Promise.resolve().then(() => oldCapture?.stop()).catch(() => {}), pending?.then(device => device.stop()).catch(() => {})]);
    deps.setGain(1);
    emit({ active: false, starting: false, listening: false, transcript: '' });
    return released;
  }
  function fail(message: string) { stop(); deps.onError(message); }
  function drain() {
    // 回包可能乱序，始终按说话顺序交付；关闭后未发送的定稿全部丢弃。
    while (state.active && segments[0]?.done) {
      const item = segments.shift()!;
      if (item.text.trim()) deps.submit(item.text.trim());
    }
  }
  function open(seq: number) {
    if (seq !== generation) return;
    if (segments.length >= 4) { fail('语音识别响应超时，请重新开启双工'); return; }
    const item: Segment = { finishing: false, done: false, text: '', partial: '', updatedAt: now(), openedAt: now() };
    segments.push(item);
    current = item;
    item.session = deps.openSession({
      onReady() { if (seq === generation) failures = 0; },
      onPartial(text) {
        if (seq !== generation || item.done || item.finishing || current !== item) return;
        const next = text.trim();
        if (next && next !== item.partial) {
          item.partial = next;
          item.updatedAt = now();
          emit({ transcript: next });
        }
      },
      onFinal(text) {
        if (seq !== generation || item.done) return;
        item.done = true;
        item.text = text;
        item.session?.close();
        if (current === item) { current = null; open(seq); }
        if (!current?.partial) emit({ transcript: '' });
        drain();
      },
      onError(message) {
        if (seq !== generation || item.done) return;
        item.done = true;
        item.session?.close();
        drain();
        if (current !== item) return;
        current = null;
        if (++failures > 3) { fail(message); return; }
        emit({ transcript: '' });
        retry = setTimeout(() => { retry = null; open(seq); }, Math.min(250 * 2 ** (failures - 1), 2000));
      },
    });
  }
  function advance() {
    if (!state.active) return;
    const time = now();
    if (state.listening && time - speechAt >= 700) {
      emit({ listening: false });
      deps.setGain(1);
    }
    const item = current;
    if (!item || item.done || item.finishing || !item.session) return;
    // partial 仅用于预览与断句；只有服务器 final 才能成为业务提问。
    const quiet = time - Math.max(item.updatedAt, speechAt) >= 1000;
    if ((item.partial && quiet) || time - item.openedAt >= 110_000) {
      item.finishing = true;
      current = null;
      emit({ transcript: '' });
      item.session.finish();
      if (state.active && !current) open(generation);
    }
  }
  async function start() {
    if (state.active || state.starting) return;
    const seq = ++generation;
    failures = 0;
    speechAt = -Infinity;
    speechStart = 0;
    emit({ starting: true });
    try {
      await released;
      if (seq !== generation) return;
      const pending = deps.startCapture({
        isCurrent: () => seq === generation,
        onFrame(frame) { if (seq === generation) current?.session?.pushFrame(frame); },
        onLevel(level) {
          if (seq !== generation || !state.active) return;
          const time = now();
          // 连续 120ms 达到人声电平再压低播报，避免单帧噪声闪动。
          if (level >= 0.015) {
            if (!speechStart) speechStart = time;
            if (time - speechStart >= 120) {
              speechAt = time;
              if (!state.listening) { emit({ listening: true }); deps.setGain(0.25); }
            }
          } else speechStart = 0;
        },
        onError(message) { if (seq === generation) fail(message); },
      });
      pendingCapture = pending;
      const next = await pending;
      const ownsCapture = pendingCapture === pending;
      if (ownsCapture) pendingCapture = null;
      if (seq !== generation) { if (ownsCapture) await next.stop(); return; }
      capture = next;
      emit({ active: true, starting: false });
      open(seq);
      if (seq === generation) tick = setInterval(advance, 100);
    } catch (error) {
      if (seq === generation) fail(error instanceof Error ? error.message : '无法开启双工语音');
    }
  }
  return { start, stop, advance };
}
