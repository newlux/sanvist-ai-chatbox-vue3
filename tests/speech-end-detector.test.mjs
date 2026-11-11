import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-speech-end-'));
const outfile = path.join(temp, 'detector.mjs');
await build({ entryPoints: ['src/utils/asr/speech-end-detector.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
after(() => rm(temp, { recursive: true, force: true }));
const { createSpeechEndDetector } = await import(pathToFileURL(outfile));

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let sent = 0;
  let paused = false;
  const detector = createSpeechEndDetector({ onSilence: () => { sent++; }, isPaused: () => paused });
  t.after(detector.reset);
  return { detector, sent: () => sent, pause: value => { paused = value; }, tick: ms => t.mock.timers.tick(ms) };
}

test('确认静音后准确计时 1.5 秒，不依赖后续音量回调', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.08);
  detector.observeLevel(0.001);
  tick(1499);
  assert.equal(sent(), 0);
  tick(1);
  assert.equal(sent(), 1);
  detector.observeLevel(0);
  tick(3000);
  assert.equal(sent(), 1);
});

test('iOS 轻声低于固定阈值，但有字幕证明开口时仍会自动收尾', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.006);
  detector.observeTranscript('查看设备情况');
  tick(1500);
  assert.equal(sent(), 1);
});

test('设备底噪略高于旧固定阈值时，按本轮人声峰值判定静音', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.09);
  detector.observeTranscript('你好');
  detector.observeLevel(0.025);
  tick(1500);
  assert.equal(sent(), 1);
});

test('继续说话会撤销静音计时，下一次静音重新计满 1.5 秒', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.08);
  detector.observeLevel(0);
  tick(1000);
  detector.observeLevel(0.06);
  tick(2000);
  assert.equal(sent(), 0);
  detector.observeLevel(0);
  tick(1500);
  assert.equal(sent(), 1);
});

test('新字幕延后截止点，重复字幕不会无限续期', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.001);
  detector.observeTranscript('查看');
  tick(1000);
  detector.observeTranscript('查看设备');
  tick(1000);
  detector.observeTranscript('查看设备');
  assert.equal(sent(), 0);
  tick(500);
  assert.equal(sent(), 1);
});

test('仅字幕不变化或音量仍有人声时，不凭文本停顿发送', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeTranscript('查看设备');
  tick(3000);
  assert.equal(sent(), 0);
  detector.observeLevel(0.08);
  tick(3000);
  assert.equal(sent(), 0);
});

test('从未开口的纯静音不触发发送', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0);
  detector.observeTranscript('  ');
  tick(8000);
  assert.equal(sent(), 0);
});

test('长按期间即使有字幕和静音，也交给松手决定发送或取消', t => {
  const { detector, sent, tick, pause } = fixture(t);
  pause(true);
  detector.observeLevel(0.08);
  detector.observeTranscript('测试');
  detector.observeLevel(0);
  tick(5000);
  assert.equal(sent(), 0);
});

test('取消或重新开始时清理旧计时器，旧轮次不会结束新录音', t => {
  const { detector, sent, tick } = fixture(t);
  detector.observeLevel(0.08);
  detector.observeLevel(0);
  tick(1000);
  detector.reset();
  detector.observeLevel(0);
  tick(3000);
  assert.equal(sent(), 0);
});

test('无效音量不是静音，已经排队时暂停也不会发送', t => {
  const { detector, sent, tick, pause } = fixture(t);
  detector.observeLevel(0.08);
  detector.observeLevel(NaN);
  detector.observeLevel(-1);
  tick(3000);
  assert.equal(sent(), 0);
  detector.observeLevel(0);
  pause(true);
  tick(1500);
  assert.equal(sent(), 0);
});
