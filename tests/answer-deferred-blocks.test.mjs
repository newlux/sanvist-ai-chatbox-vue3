import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createRenderer, defineComponent, h, nextTick, provide, ref, unref } from 'vue';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-deferred-blocks-'));
after(() => rm(temp, { recursive: true, force: true, maxRetries: 3 }));
const componentRoot = path.resolve('src/components/ai-bubble-v2');
await build({
  entryPoints: [path.join(componentRoot, 'AiContentBlocks.vue')], outfile: path.join(temp, 'content.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'vue-regression-fixture', setup(builder) {
    builder.onResolve({ filter: /^vue$/ }, () => ({ path: path.resolve('node_modules/vue/index.mjs'), external: true }));
    builder.onResolve({ filter: /^@\// }, args => {
      if (args.path === '@/hooks/useTypewriter') return { path: path.resolve('src/hooks/useTypewriter.ts') };
      return { path: args.path, namespace: 'fixture' };
    });
    builder.onResolve({ filter: /ChartBlock\.vue$/ }, () => ({ path: 'chart', namespace: 'fixture' }));
    builder.onResolve({ filter: /AiBlockRenderer\.vue$/ }, () => ({ path: 'renderer', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === '@/stores' ? 'export const useChatScope=()=>"guide";'
        : args.path === '@/utils/ai-stream' ? 'export const expandChartFences=x=>x; export const expandMarkdownTables=x=>x;'
          : args.path === 'renderer'
            ? `import {h} from 'vue';export default {props:['block'],setup:p=>()=>h('div',{'data-block':p.block.type},p.block.id)};`
            : `import {h} from 'vue';export default {props:['content'],setup:p=>()=>h('text',{},p.content)};`,
    }));
    builder.onLoad({ filter: /\.vue$/ }, async args => {
      const { descriptor } = parse(await readFile(args.path, 'utf8'), { filename: args.path });
      const script = compileScript(descriptor, { id: args.path, inlineTemplate: true });
      return { contents: script.content, loader: 'ts', resolveDir: path.dirname(args.path) };
    });
  } }],
});
const { default: Content } = await import(pathToFileURL(path.join(temp, 'content.mjs')));
const renderer = createRenderer({
  createElement: tag => ({ tag, children: [], props: {} }),
  createText: text => ({ text }), createComment: text => ({ comment: text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; node.children = []; },
  patchProp: (node, key, _old, value) => { node.props[key] = value; },
  insert(node, parent, anchor) {
    if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1); }
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node);
  },
  remove(node) { const index = node.parent?.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1); },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});
function mount(t, blocks, loading = false) {
  const count = ref(0), root = { children: [] }, errors = [];
  const app = renderer.createApp(defineComponent({ setup() {
    provide('ai-bubble-typewriter', ref(true));
    provide('ai-bubble-answer-typing', count);
    return () => h(Content, { blocks: unref(blocks), loading: unref(loading) });
  } }));
  app.config.errorHandler = error => errors.push(error);
  app.mount(root); t.after(() => app.unmount());
  const find = (type, node = root) => node.props?.['data-block'] === type || node.children?.some(child => find(type, child));
  return { root, count, errors, find };
}

test('参考资料位于两段正文之间时，正文完成后显示参考资料及推荐问题，不重复打字', async t => {
  const f = mount(t, [
    { id: 'a1', type: 'answer', complete: true, payload: { content: '甲' } },
    { id: 'source', type: 'source', complete: true, payload: { evidence: [{}] } },
    { id: 'a2', type: 'answer', complete: true, payload: { content: '乙' } },
    { id: 'questions', type: 'guide-suggestion', complete: true, payload: { options: ['问题'] } },
  ]);
  await nextTick();
  assert.equal(Boolean(f.find('source')), false);
  await new Promise(resolve => setTimeout(resolve, 250)); await nextTick();
  assert.deepEqual(f.errors, []);
  assert.equal(f.count.value, 0, '正文应结束，不能因参考资料的显示反复重新计入打字状态');
  assert.equal(Boolean(f.find('source')), true);
  assert.equal(Boolean(f.find('guide-suggestion')), true);
});

for (const type of ['image', 'guide-suggestion']) {
  test(`${type} 夹在两段正文之间时，不改变正文实例或阻塞参考资料`, async t => {
    const f = mount(t, [
      { id: 'a1', type: 'answer', complete: true, payload: { content: '甲' } },
      { id: 'middle', type, complete: true, payload: {} },
      { id: 'a2', type: 'answer', complete: true, payload: { content: '乙' } },
      { id: 'source', type: 'source', complete: true, payload: { evidence: [{}] } },
    ]);
    await new Promise(resolve => setTimeout(resolve, 250)); await nextTick();
    assert.deepEqual(f.errors, []);
    assert.equal(f.count.value, 0);
    assert.equal(Boolean(f.find(type)), true);
    assert.equal(Boolean(f.find('source')), true);
  });
}

test('流式生成结束后才展示参考和追问，释放显示时不会重新启动正文打字', async t => {
  const loading = ref(true);
  const f = mount(t, [
    { id: 'a1', type: 'answer', complete: true, payload: { content: '甲' } },
    { id: 'source', type: 'source', complete: true, payload: { evidence: [{}] } },
    { id: 'a2', type: 'answer', complete: true, payload: { content: '乙' } },
    { id: 'questions', type: 'guide-suggestion', complete: true, payload: {} },
  ], loading);
  await new Promise(resolve => setTimeout(resolve, 120)); await nextTick();
  assert.equal(f.count.value, 0);
  assert.equal(Boolean(f.find('source')), false);
  loading.value = false;
  await nextTick();
  assert.equal(f.count.value, 0);
  assert.equal(Boolean(f.find('source')), true);
  assert.equal(Boolean(f.find('guide-suggestion')), true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(f.count.value, 0);
  assert.deepEqual(f.errors, []);
});
