import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';

const temp=await mkdtemp(path.join(tmpdir(),'sanvist-transcript-render-'));
const outfile=path.join(temp,'content.mjs');
await build({
  stdin:{contents:'export { default as Content } from "./src/components/report-broadcast-player/report-broadcast-content.vue"; export { createRenderer, reactive, h, nextTick } from "vue";',resolveDir:process.cwd(),loader:'ts'},
  outfile,bundle:true,platform:'node',format:'esm',
  plugins:[{name:'compile-real-content',setup(build){
    build.onLoad({filter:/\.vue$/,namespace:'file'},async args=>{
      const {descriptor}=parse(await readFile(args.path,'utf8'),{filename:args.path,templateParseOptions:{isCustomElement:tag=>['view','text','scroll-view','image'].includes(tag)}});
      return {contents:compileScript(descriptor,{id:'transcript-test',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','scroll-view','image'].includes(tag)}}}).content,loader:'ts'};
    });
    build.onResolve({filter:/^(vue-i18n|@\/)/},args=>args.path==='@/utils/voice-message-motion'
      ? {path:path.resolve('src/utils/voice-message-motion.ts')} : {path:args.path,namespace:'mock'});
    build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:
      args.path==='vue-i18n'?'export const useI18n=()=>({t:key=>key});':
      args.path==='@/stores'?'export const useSystemStore=()=>({isDark:true});':
      args.path.startsWith('@/components/')?'export default {render(){return null}};':'export default "test-asset";'
    }));
  }}],
});
after(()=>rm(temp,{recursive:true,force:true}));
const {Content,createRenderer,reactive,h,nextTick}=await import(pathToFileURL(outfile));
const originalHTMLElement=globalThis.HTMLElement;
const originalResizeObserver=globalThis.ResizeObserver;
const resizeObservers=[];
globalThis.ResizeObserver=class {
  constructor(callback){this.callback=callback;resizeObservers.push(this);}
  observe(element){this.element=element;}
  disconnect(){this.disconnected=true;}
};
after(()=>{globalThis.ResizeObserver=originalResizeObserver;});
const textOf=node=>(node.comment?'':node.text||'')+(node.children||[]).map(textOf).join('');
class HostElement extends EventTarget {
  constructor(type){super();this.type=type;this.props={};this.children=[];this.style={};this.position=0;}
  querySelector(){return this;}
  get scrollHeight(){return Math.max(26,Math.ceil(textOf(this).length/12)*26+12)+Number(this.extraHeight||0);}
  get clientHeight(){return 100;}
  get scrollTop(){return Math.min(this.position,Math.max(0,this.scrollHeight-this.clientHeight));}
  set scrollTop(value){this.position=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}
}
globalThis.HTMLElement=HostElement;
after(()=>{globalThis.HTMLElement=originalHTMLElement;});
const renderer=createRenderer({
  createElement:type=>new HostElement(type),createText:text=>({text}),createComment:()=>({comment:true}),
  setText(node,text){node.text=text;},setElementText(node,text){node.text=text;node.children=[];},
  patchProp(node,key,_old,value){node.props[key]=value;},
  insert(node,parent,anchor){if(node.parent){node.parent.children.splice(node.parent.children.indexOf(node),1);}node.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;if(i<0)parent.children.push(node);else parent.children.splice(i,0,node);},
  remove(node){if(node?.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);},
  parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1]||null,
});
const settle=async()=>{await nextTick();await nextTick();};
function fixture(t){
  t.mock.timers.enable({apis:['setInterval']});
  const state=reactive({playing:true,loading:false,currentSeq:1,transcriptSegments:[{seq:1,text:'当前播报句子的文字逐字出现。'}],progress:0});
  const root={children:[]};const app=renderer.createApp({setup:()=>()=>h(Content,{...state})});app.mount(root);t.after(()=>app.unmount());
  const find=node=>node.type==='scroll-view'&&node.props.class==='report-broadcast-content__transcript-content'?node:node.children?.map(find).find(Boolean);
  return {state,root,viewport:find(root),tick:async()=>{t.mock.timers.tick(80);await settle();}};
}
const atBottom=element=>assert.equal(element.scrollTop,Math.max(0,element.scrollHeight-element.clientHeight));

test('真实字幕组件新增几十句后始终滚到内容底部，高亮只出现在当前句',async t=>{
  const {state,viewport,tick}=fixture(t);await settle();
  for(let seq=2;seq<=40;seq++){
    state.transcriptSegments.push({seq,text:`第${seq}句已开始播报，文字跟随录音逐字出现。`});state.currentSeq=seq;
    await settle();await tick();atBottom(viewport);
    const current=viewport.children[0].children.filter(node=>String(node.props?.class).includes('segment--current'));
    assert.equal(current.length,1);
  }
});

test('当前长句不断换行时直接跟随内容底部，不需要切到下一句才滚动',async t=>{
  const {state,viewport,tick}=fixture(t);
  state.transcriptSegments[0].text='这是一段很长的播报文字。'.repeat(12);await settle();
  for(let index=0;index<100;index++){await tick();atBottom(viewport);}
  assert.ok(viewport.scrollTop>0);
});

test('暂停时允许停留阅读，恢复播放后回到底部',async t=>{
  const {state,viewport}=fixture(t);
  state.transcriptSegments=Array.from({length:20},(_,index)=>({seq:index+1,text:'已经播报过的历史文字。'}));state.currentSeq=20;await settle();atBottom(viewport);
  state.playing=false;await settle();viewport.scrollTop=0;await settle();assert.equal(viewport.scrollTop,0);
  state.playing=true;await settle();atBottom(viewport);
});


test('播放中滚动后仍回到底部，不会让当前高亮句长期留在屏幕外',async t=>{
  const {state,viewport}=fixture(t);
  state.transcriptSegments=Array.from({length:30},(_,index)=>({seq:index+1,text:'已经播报过的历史内容。'}));state.currentSeq=30;await settle();
  viewport.scrollTop=0;viewport.props.onScroll();await settle();atBottom(viewport);
});

test('WebView 延后更新文字高度时，由内容高度变化补一次贴底',async t=>{
  const {state,viewport}=fixture(t);
  state.transcriptSegments=Array.from({length:20},(_,index)=>({seq:index+1,text:'已经播报过的历史内容。'}));state.currentSeq=20;await settle();
  viewport.extraHeight=240;
  const observer=resizeObservers.findLast(item=>!item.disconnected);
  assert.ok(observer);
  observer.callback();await settle();atBottom(viewport);
});

test('滚动在布局帧执行，使用更新后的总高度而不是上一帧旧值',async t=>{
  const {state,viewport}=fixture(t);await settle();
  const oldRaf=globalThis.requestAnimationFrame, oldCancel=globalThis.cancelAnimationFrame;
  const frames=[];globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};globalThis.cancelAnimationFrame=()=>{};
  t.after(()=>{globalThis.requestAnimationFrame=oldRaf;globalThis.cancelAnimationFrame=oldCancel;});
  state.transcriptSegments.push({seq:2,text:'第二句播报内容已经开始。'});state.currentSeq=2;await settle();
  assert.equal(frames.length,1);
  viewport.extraHeight=300;
  frames.shift()();atBottom(viewport);
});


const hasTopFade=node=>String(node.props?.class).includes('report-broadcast-content__top-fade')||(node.children||[]).some(hasTopFade);

test('短句未超过文字区时停在顶部，顶部渐隐不遮挡第一句',async t=>{
  const {state,root,viewport,tick}=fixture(t);
  state.transcriptSegments[0].text='测试';await settle();await tick();await tick();
  assert.ok(viewport.scrollHeight<viewport.clientHeight);
  assert.equal(viewport.scrollTop,0);
  assert.equal(hasTopFade(root),false);
});

test('从短句增长到超过高度后才滚底，并启用上方旧文字渐隐',async t=>{
  const {state,root,viewport,tick}=fixture(t);
  state.transcriptSegments[0].text='测试';await settle();await tick();
  assert.equal(viewport.scrollTop,0);
  assert.equal(hasTopFade(root),false);
  state.transcriptSegments[0].text='这句话逐字增长并不断换行。'.repeat(10);await settle();
  for(let index=0;index<60;index++) await tick();
  assert.ok(viewport.scrollTop>0);atBottom(viewport);
  assert.equal(hasTopFade(root),true);
});

test('暂停后翻到第一句时移除上方渐隐，不强制滚回底部',async t=>{
  const {state,root,viewport}=fixture(t);
  state.transcriptSegments=Array.from({length:20},(_,index)=>({seq:index+1,text:'已经播报过的内容。'}));state.currentSeq=20;await settle();
  assert.equal(hasTopFade(root),true);
  state.playing=false;await settle();viewport.scrollTop=0;viewport.props.onScroll();await settle();
  assert.equal(viewport.scrollTop,0);
  assert.equal(hasTopFade(root),false);
});

test('uni H5 两层同名容器时操作真正的内层滚动节点，不操作外层包装',async t=>{
  const {state,viewport}=fixture(t);
  const wrapper={scrollHeight:100,clientHeight:100,scrollTop:0};
  const main=new HostElement('main');
  Object.defineProperty(main,'children',{get:()=>viewport.children});
  viewport.querySelector=selector=>selector==='.uni-scroll-view > .uni-scroll-view'?main:wrapper;
  state.transcriptSegments=Array.from({length:30},(_,index)=>({seq:index+1,text:'已经播报过的内容。'}));state.currentSeq=30;await settle();
  assert.ok(main.scrollTop>0);atBottom(main);
  assert.equal(wrapper.scrollTop,0);
});

test('uni 组件暴露 $getMain 时直接使用，不依赖包装层选择器',async t=>{
  const {state,viewport}=fixture(t);
  const main=new HostElement('main');Object.defineProperty(main,'children',{get:()=>viewport.children});
  viewport.$getMain=()=>main;
  viewport.querySelector=()=>{throw new Error('不应查询包装层');};
  state.transcriptSegments=Array.from({length:20},(_,index)=>({seq:index+1,text:'已经开始播报的内容。'}));state.currentSeq=20;await settle();
  assert.ok(main.scrollTop>0);atBottom(main);
});

test('不再每秒轮询，独立的内容高度事件仍可触发贴底',async t=>{
  const {state,viewport,tick}=fixture(t);
  state.transcriptSegments[0].text='测试';await settle();await tick();await tick();await tick();
  assert.equal(viewport.scrollTop,0);
  viewport.extraHeight=500;
  t.mock.timers.tick(2000);await settle();
  assert.equal(viewport.scrollTop,0);
  resizeObservers.findLast(item=>!item.disconnected).callback();await settle();
  assert.ok(viewport.scrollTop>0);atBottom(viewport);
});

test('暂停或录音时高度事件不强制贴底，恢复播放后继续跟随',async t=>{
  const {state,viewport}=fixture(t);state.playing=false;await settle();viewport.extraHeight=500;
  resizeObservers.findLast(item=>!item.disconnected).callback();await settle();assert.equal(viewport.scrollTop,0);
  state.playing=true;await settle();atBottom(viewport);
  state.voiceRecording=true;await settle();viewport.scrollTop=0;
  resizeObservers.findLast(item=>!item.disconnected).callback();await settle();assert.equal(viewport.scrollTop,0);
  state.voiceRecording=false;await settle();atBottom(viewport);
});
