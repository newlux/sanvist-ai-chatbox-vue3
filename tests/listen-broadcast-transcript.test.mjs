import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-played-transcript-'));
const outfile = path.join(temp, 'player.mjs');
const mocks = {
  'fixture-control': 'export const control = { streams: [], audios: [] };',
  howler: `import { control } from 'fixture-control';
    export class Howl {
      constructor(options) { this.options=options; control.audios.push(this); }
      start() { this.options.onplay?.(); }
      end() { this.options.onend?.(); }
      fail() { this.options.onloaderror?.(0, 'mock failure'); }
      play() { this.start(); }
      pause() {} stop() {} unload() {}
      seek() { return 5; } duration() { return 10; }
    }`,
  '@/api/listen-broadcast/play-stream': `import { control } from 'fixture-control';
    export function consumeListenBroadcastStream(params, onEvent, onError, onClose) {
      const stream={params,onEvent,onError,onClose,cancelled:false}; control.streams.push(stream);
      return { cancel() { stream.cancelled=true; } };
    }`,
  '@/hooks/useReportPlaybackRate': 'export const loadReportPlaybackRate=()=>1.2; export const saveReportPlaybackRate=()=>{};',
  '@/hooks/useReportStyle': 'export const resolveReportStyleCode=()=>"";',
  '@/hooks/useReportVoice': 'export const resolveReportVoiceId=()=>"";',
  '@/utils/logger': 'export const createLogger=()=>({info(){},warn(){},error(){}});',
};
await build({
  stdin: { contents: 'export { useListenBroadcastPlayer } from "./src/hooks/useListenBroadcastPlayer"; export { createRenderer } from "vue"; export { control } from "fixture-control";', resolveDir: process.cwd(), loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name:'mock-transport-audio', setup(build) {
    build.onResolve({filter:/^(fixture-control|howler|@\/)/}, args => args.path in mocks ? {path:args.path,namespace:'mock'} : null);
    build.onLoad({filter:/.*/,namespace:'mock'}, args => ({contents:mocks[args.path],loader:'js'}));
  } }],
});
after(() => rm(temp, { recursive: true, force: true }));
const { useListenBroadcastPlayer, createRenderer, control } = await import(pathToFileURL(outfile));
const renderer=createRenderer({
  createComment:()=>({}), insert(){}, remove(){}, parentNode:()=>null, nextSibling:()=>null,
});
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  control.streams.length=0; control.audios.length=0;
  let player;
  const app=renderer.createApp({setup(){player=useListenBroadcastPlayer();return()=>null;}});
  app.mount({}); t.after(()=>app.unmount());
  player.play({voice:'test'});
  const receive=(seq,text=`第${seq}句`) => control.streams.at(-1).onEvent({seq,text,dataUrl:'data:audio/mpeg;base64,AQID'});
  const sequences=()=>player.transcriptSegments.value.map(item=>item.seq);
  return {player,receive,sequences,tick:ms=>t.mock.timers.tick(ms)};
}

test('即使整篇分片已到齐，真正开播前不插入文字，开播时只插入当前句', t=>{
  const {player,receive,sequences}=fixture(t);
  for(let seq=1;seq<=100;seq++) receive(seq);
  assert.deepEqual(sequences(),[]);
  assert.equal(player.currentSeq.value,null);
  assert.equal(control.audios.length,1);
  control.audios[0].start();
  assert.deepEqual(sequences(),[1]);
  assert.equal(player.currentSeq.value,1);
});

test('连续播放到后半篇仍逐句追加，句间等待和音频加载期间不提前插入', t=>{
  const {receive,sequences,tick,player}=fixture(t);
  for(let seq=1;seq<=50;seq++) receive(seq);
  for(let seq=1;seq<=50;seq++) {
    const audio=control.audios.at(-1);
    assert.equal(sequences().length,seq-1);
    audio.start();
    assert.equal(sequences().length,seq);
    assert.equal(player.currentSeq.value,seq);
    audio.end(); tick(800);
  }
  assert.deepEqual(sequences(),Array.from({length:50},(_,index)=>index+1));
});

test('暂停后继续接收分片不显示，恢复当前句不会重复插入', t=>{
  const {player,receive,sequences}=fixture(t);
  receive(1); control.audios[0].start(); player.pause();
  receive(2); receive(3);
  assert.deepEqual(sequences(),[1]);
  player.resume();
  assert.deepEqual(sequences(),[1]);
});

test('乱序缓存和重复分片不会提前展示或重复播放', t=>{
  const {receive,sequences,tick}=fixture(t);
  receive(3); receive(2);
  assert.equal(control.audios.length,0);
  receive(1); receive(1);
  control.audios[0].start();
  assert.deepEqual(sequences(),[1]);
  control.audios[0].end(); tick(800);
  control.audios[1].start();
  assert.deepEqual(sequences(),[1,2]);
});

test('加载失败的分句不加入文字列表，下一句真正开播才追加', t=>{
  const {receive,sequences}=fixture(t);
  receive(1); receive(2); control.audios[0].fail();
  assert.deepEqual(sequences(),[]);
  control.audios[1].start();
  assert.deepEqual(sequences(),[2]);
});

test('播放进度仍按音频缓存总句数估算，不因只显示已播句就提前到100%', t=>{
  const {player,receive,tick}=fixture(t);
  for(let seq=1;seq<=10;seq++) receive(seq);
  control.audios[0].start(); tick(250);
  assert.equal(player.playbackProgress.value,0.05);
});

test('回退播放时移除后面文字，重播到哪句再插入哪句', t=>{
  const {player,receive,sequences,tick}=fixture(t);
  for(let seq=1;seq<=3;seq++) receive(seq);
  for(let seq=1;seq<=3;seq++) {const audio=control.audios.at(-1);audio.start();if(seq<3){audio.end();tick(800);}}
  player.seekToSegment(1);
  assert.deepEqual(sequences(),[]);
  control.audios.at(-1).start();
  assert.deepEqual(sequences(),[1]);
});

test('切倍速从当前句续播，不把新流中跳过或待播的句子塞入文字区域', t=>{
  const {player,receive,sequences,tick}=fixture(t);
  receive(1); receive(2); control.audios[0].start(); control.audios[0].end();tick(800);control.audios[1].start();
  player.setPlaybackRate(1.5);
  assert.deepEqual(sequences(),[]);
  receive(1); receive(2); receive(3);
  assert.deepEqual(sequences(),[]);
  control.audios.at(-1).start();
  assert.deepEqual(sequences(),[2]);
});

test('停止后旧音频迟到的播放回调不能插入旧文字', t=>{
  const {player,receive,sequences}=fixture(t);
  receive(1);const audio=control.audios[0];player.stop();audio.start();
  assert.deepEqual(sequences(),[]);
});
