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
const PLAYBACK_TAIL_MS = 1800;
const MAX_PLAYBACK_REFERENCES = 8;

function normalizeSpeech(text: string) {
  // 旧版 WebView 不支持 Unicode 属性转义。
  return text.normalize("NFKC").toLowerCase()
    .replace(/[^0-9a-z\u00c0-\u024f\u0370-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, "");
}

function resemblesPlayback(text: string, references: string[]) {
  if (!references.length) return false;
  const speech = normalizeSpeech(text);
  if (speech && references.includes(speech)) return true;
  const minimumLength = /[\u3400-\u9fff]/.test(speech) ? 4 : 8;
  if (speech.length < minimumLength) return false;

  const playback = references.join("");
  if (playback.includes(speech)) return true;
  if (speech.length < 10) return false;

  // 少量 ASR 错字时比较相邻字对。要求大部分识别内容都与播报重合。
  const pairs = new Map<string, number>();
  for (let index = 1; index < playback.length; index += 1) {
    const pair = playback.slice(index - 1, index + 1);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  let matches = 0;
  for (let index = 1; index < speech.length; index += 1) {
    const pair = speech.slice(index - 1, index + 1);
    const remaining = pairs.get(pair) || 0;
    if (remaining > 0) {
      matches += 1;
      pairs.set(pair, remaining - 1);
    }
  }
  return matches / (speech.length - 1) >= 0.84;
}

interface Segment {
  session?: AsrStreamSession;
  finishing: boolean;
  done: boolean;
  text: string;
  partial: string;
  updatedAt: number;
  openedAt: number;
  playbackReferences: string[];
  lastPlaybackAt: number;
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
  let playbackText = "";
  const recentPlayback: Array<{ text: string; endedAt: number }> = [];

  function rememberPlayback(item: Segment) {
    const references = item.playbackReferences;
    const time = now();
    if (!item.partial && time - item.lastPlaybackAt > PLAYBACK_TAIL_MS) references.length = 0;
    for (const playback of recentPlayback) {
      if (time - playback.endedAt > PLAYBACK_TAIL_MS) continue;
      item.lastPlaybackAt = Math.max(item.lastPlaybackAt, playback.endedAt);
      if (!references.includes(playback.text)) references.push(playback.text);
    }
    if (playbackText) {
      item.lastPlaybackAt = time;
      if (!references.includes(playbackText)) references.push(playbackText);
    }
    if (references.length > MAX_PLAYBACK_REFERENCES) {
      references.splice(0, references.length - MAX_PLAYBACK_REFERENCES);
    }
  }

  function setPlaybackText(text: string) {
    const normalized = normalizeSpeech(text);
    if (normalized === playbackText) return;
    if (playbackText) {
      recentPlayback.push({ text: playbackText, endedAt: now() });
      if (recentPlayback.length > MAX_PLAYBACK_REFERENCES) recentPlayback.shift();
    }
    playbackText = normalized;
    if (current) rememberPlayback(current);
  }
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
    const item: Segment = { finishing: false, done: false, text: '', partial: '', updatedAt: now(), openedAt: now(), playbackReferences: [], lastPlaybackAt: -Infinity };
    rememberPlayback(item);
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
          emit({ transcript: resemblesPlayback(next, item.playbackReferences) ? '' : next });
        }
      },
      onFinal(text) {
        if (seq !== generation || item.done) return;
        item.done = true;
        item.text = resemblesPlayback(text, item.playbackReferences) ? '' : text;
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
        onFrame(frame) {
          if (seq !== generation || !current) return;
          rememberPlayback(current);
          current.session?.pushFrame(frame);
        },
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
  return { start, stop, advance, setPlaybackText };
}
