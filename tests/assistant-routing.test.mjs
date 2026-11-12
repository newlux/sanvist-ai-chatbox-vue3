import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-assistant-routing-'));
after(() => rm(temp, { recursive: true, force: true }));
await build({
  entryPoints: ['src/utils/ai-stream/dify.ts', 'src/utils/ai-stream/chatStreamParser.ts', 'src/utils/ai-stream/role-tag.ts', 'src/utils/ai-stream/voice-style-tag.ts', 'src/utils/ask-slot-query.ts'],
  outdir: temp, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  define: { 'import.meta.env': '{}' },
});
const load = file => import(pathToFileURL(path.join(temp, file)));
const { createDifyEventNormalizer, extractDifyHistoryBlocks } = await load('ai-stream/dify.mjs');
const { applyEventToBlocks } = await load('ai-stream/chatStreamParser.mjs');
const { parseRoleTaggedAnswer } = await load('ai-stream/role-tag.mjs');
const { parseVoiceStyleTag } = await load('ai-stream/voice-style-tag.mjs');
const { buildAskSlotQuery } = await load('ask-slot-query.mjs');
function parse(component, split = false) {
  const normalize = createDifyEventNormalizer();
  const source = `<COMPONENT>${JSON.stringify(component)}</COMPONENT>`;
  const parts = split ? [...source] : [source];
  return parts.flatMap(answer => normalize({ event: 'message', conversation_id: 'session-1', message_id: 'message-1', answer }) || []);
}

for (const target of ['operations_assistant', 'work_guidance_assistant', 'task_coordination_assistant']) {
  test(`站内跳转 ${target} 支持分片，保留会话且不渲染 JSON`, () => {
    const events = parse({ scene: 'ask', type: 'navigation', data: { target, intent: 'ENTER_ASSISTANT' } }, true);
    const event = events.find(item => item.event === 'assistant_scene');
    assert.equal(event.data.target, target);
    assert.equal(event.conversationId, 'session-1');
    const snapshot = applyEventToBlocks([], event);
    assert.equal(snapshot.assistantScene, target);
    assert.deepEqual(snapshot.blocks, []);
  });
}
for (const target of ['maintenance_assistant', 'parts_assistant']) {
  test(`外部助手 ${target} 保留指令卡`, () => {
    const event = parse({ scene: 'ask', type: 'navigation', data: { target, intent: 'ENTER_ASSISTANT', context: { query: '进入助手' } } }).find(item => item.event === 'assistant_navigation');
    assert.equal(event.data.target, target);
    assert.equal(event.data.intent, 'ENTER_ASSISTANT');
    assert.equal(event.data.context.query, '进入助手');
  });
}
for (const slot_name of ['role_selection', 'voice_style', 'assistant_selection']) {
  test(`${slot_name} 正常解析并回传指令值`, () => {
    const option = { label: '显示名称', value: '我选择完整指令' };
    const event = parse({ scene: 'ask', type: 'slot', data: { slot_name, selection: 'single', options: [option] } }).find(item => item.event === 'ask_slot');
    assert.equal(event.data.slot_name, slot_name);
    assert.equal(buildAskSlotQuery({ slot: event.data, selectedOptions: [option] }), option.value);
  });
}
test('普通业务槽位仍提交可读 label，多步骤表单保持原协议', () => {
  assert.equal(buildAskSlotQuery({ slot: { slot_name: 'time' }, selectedOptions: [{ label: '昨天', value: 'yesterday' }] }), '昨天');
  assert.equal(buildAskSlotQuery({ answers: [{ question: '设备', answer: '泵车' }] }), 'Q1: 设备，A1: 泵车');
});
for (const language of ['zh', 'en']) {
  test(`语言指令 ${language} 不产生空卡片`, () => {
    const event = parse({ scene: 'ask', type: 'language_switch', data: { language } }).find(item => item.event === 'language_switch');
    const snapshot = applyEventToBlocks([], event);
    assert.equal(snapshot.languageSwitch, language);
    assert.deepEqual(snapshot.blocks, []);
  });
}
test('角色和音色标签保留正文，历史跳转不执行', () => {
  for (const role of ['OWNER', 'OPERATOR', 'ADMIN']) {
    assert.deepEqual(parseRoleTaggedAnswer(`<${role}>切换成功</${role}>`), { role, text: '切换成功' });
  }
  assert.deepEqual(parseVoiceStyleTag('<VOICE_STYLE style="longanyang_v3.1">切换成功</VOICE_STYLE>'), { matched: true, style: 'longanyang_v3.1', text: '切换成功' });
  assert.deepEqual(extractDifyHistoryBlocks('<COMPONENT>{"scene":"ask","type":"navigation","data":{"target":"operations_assistant"}}</COMPONENT>'), []);
});

// 执行真实共享 hook，外部跳转、存储和发送全部替换为内存记录。
await build({
  entryPoints: ['src/hooks/useAssistantNavigation.ts'], outfile: path.join(temp, 'navigation.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'navigation-mocks', setup(build) {
    build.onResolve({ filter: /^@\/(stores|config|utils\/(parts-h5|repair-h5|repair-callback|repair-navigation))$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export const useUserStore = () => ({userId:'user-1'});
      export const REPAIR_NAV_INTENT_ENTER='ENTER_ASSISTANT', REPAIR_NAV_INTENT_FAULT_CODE='MAINT_FAULT_CODE';
      export const openPartsAssistant=(...args)=>globalThis.navCalls.push(['parts',...args]);
      export const openRepairAssistant=(...args)=>globalThis.navCalls.push(['repair',...args]);
      export const stashPendingRepairCallback=(...args)=>globalThis.navCalls.push(['callback',...args]);
      export const stashPendingRepairNavigationContext=(...args)=>globalThis.navCalls.push(['context',...args]);
    ` }));
  } }],
});
const { useAssistantNavigation } = await load('navigation.mjs');
test('共享执行：配件弹层及维修确认/直接进入都执行在当前助手', () => {
  globalThis.navCalls = [];
  const prompts = [];
  const nav = useAssistantNavigation(query => prompts.push(query));
  const parts = { target: 'parts_assistant', intent: 'ENTER_ASSISTANT' };
  nav.onAssistantNavigationOpen(parts);
  assert.equal(nav.assistantNavigationVisible.value, true);
  nav.onAssistantNavigationConfirm(parts);
  assert.equal(globalThis.navCalls[0][0], 'parts');
  const repair = { target: 'maintenance_assistant', intent: 'MAINT_FAULT_CODE' };
  nav.onAssistantNavigationConfirm(repair);
  assert.deepEqual(prompts, ['确认进入维修助理']);
  assert.equal(globalThis.navCalls.length, 1);
  nav.onAssistantNavigationConfirm({ ...repair, intent: 'ENTER_ASSISTANT', sessionId: 's1', conversationId: 'c1', context: { deviceid: 'd1', query: '设备无法启动' } });
  assert.equal(globalThis.navCalls[1][0], 'callback');
  const [kind, options] = globalThis.navCalls[2];
  assert.equal(kind, 'repair');
  assert.equal(options.sessionId, 's1');
  assert.equal(options.conversationId, 'c1');
  assert.equal(options.question, '设备无法启动');
  options.onFallback();
  assert.deepEqual(globalThis.navCalls[3], ['context', { deviceid: 'd1', query: '设备无法启动', userId: 'user-1', sessionId: 's1', conversationId: 'c1' }]);
  nav.onAssistantNavigationConfirm({ ...repair, intent: 'UNKNOWN' });
  assert.equal(globalThis.navCalls.length, 4);
  delete globalThis.navCalls;
});
