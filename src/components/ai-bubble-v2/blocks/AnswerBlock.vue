<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { useTypewriter } from "@/hooks/useTypewriter";

defineOptions({ name: "AnswerBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  // 未结束的回答按流式处理，降低解析频率
  streaming: { type: Boolean, default: false },
  // 收尾重放（answer_layout）重新分配出来的块，由解析层打的标记，见 replayedAsFinished
  replayed: { type: Boolean, default: false },
  /**
   * 这一块是否走打字机：null（不传）= 跟随气泡级开关，true / false = 强制。
   * tips（过程提示语，如「正在检索知识库…」）由后端一次下发、本身是完整短句，
   * 逐字放出来只是让状态行显得卡顿，这里按块关掉 —— 与 GuideCheckBlock 的同名 prop 语义一致。
   */
  typewriter: { type: Boolean, default: null },
  /**
   * 落定动效（文字停更后压淡再落定）开关：null（不传）= 跟随「打字机关了才开」。
   * tips 显式传 false：它是被后端整句覆盖的状态行，每换一句文案就整行重挂一次，
   * 落定动画跟着重放（opacity 0.7 → 1），看起来就是这行字在明暗闪烁 ——
   * 思考阶段的「气泡内明暗闪烁」就是它（见 ai-bubble-v2 的思考期排查结论）。
   */
  settle: { type: Boolean, default: null },
});

const emit = defineEmits(["typing"]);

/**
 * 打字机（首页 / 作业指导页 / 任务协同页打开，见 ai-bubble-v2 的 provide）：
 * 把已到达的正文逐字放出，避免整段回答一次刷出、列表高度一次撑高导致整屏跳动。
 * 没拿到开关（听汇报 / guide-pc 等）时 visible 恒等于 content，行为不变。
 */
const typewriterOn = inject<Ref<boolean> | null>("ai-bubble-typewriter", null);
const typewriterEnabled = computed(() => Boolean(typewriterOn?.value));
/** 本块实际是否允许打字机：块级显式传 false 时直接关（tips），其余跟随气泡 */
const typewriterAllowed = computed(() => {
  if (props.typewriter === false) return false;
  return typewriterEnabled.value;
});
/**
 * 收尾重放（`replayed`）的正文不再逐字重打，挂载即整段显示。
 *
 * 这类块出现在收尾重放里：workflow_finished 的 answer_layout 会按 outputs.answer 的
 * 权威顺序把正文重新分配一遍（典型：流式期间「正文含表格源码」被拆成
 * 「表格前正文 + 表格 + 表格后正文」）。新分出来的块是刚挂载、complete 已经为 true，
 * 如果还从第一个字重打，用户看到的就是「上面的文字先消失 → 表格上移 → 文字逐字长出来
 * → 表格又被顶下去」。挂载即完成，直接整段显示，两段文字在同一帧里完成交接，视觉上不动。
 *
 * 必须是 computed：重建出来的 answer 块 id 与流式期间是同一个（见 chatStreamParser 的
 * answer_layout），组件实例被复用、不会重新 setup。做成常量的话，`replayed` 从 false 变
 * true 这一步读不到 —— 正文被权威版本覆盖后仍然走打字机，新旧文本前缀对不上就叫
 * useTypewriter 把进度回退，表现出来正是「文字先整段消失、再逐字长回来」。
 *
 * 只认 replayed 标记：整段一次性到达的回答（workflow_finished 兜底）也是挂载即完成，
 * 但那是正常新块，仍要按打字机逐字放出，不能一起跳掉。
 * 这里不依赖 streaming：重放块一定是最终正文，就算某次提交把 answer_layout 和 message_end
 * 拆成两帧，也不该再从第一个字重打。
 */
const replayedAsFinished = computed(() => Boolean(props.replayed) && props.content.trim().length > 0);
/**
 * 打字机开关一旦打开就锁住，不跟着「这轮是否还在生成」一起关。
 *
 * `ai-bubble-typewriter` 是气泡级 computed（页面开关 && isFreshAnswer），而 isFreshAnswer
 * 依赖 `loading / interrupted / processStatus` —— 生成结束时这两个条件都会翻转，开关随即变 false。
 * 长回答的逐字展示本身有追平过程（积压多时最长约 2 秒），如果结束时立刻关开关，
 * `useTypewriter` 的 visible 会直接返回整段文本，用户看到的就是
 * 「前半段正常逐字、后半段唰一下全出来」。
 * 这里只在首次为真时锁存：历史回看消息从一开始就是 false，不受影响，仍整段显示。
 */
const typewriterLatched = ref(false);
watch(
  () => typewriterAllowed.value,
  (allowed) => {
    if (allowed) typewriterLatched.value = true;
  },
  { immediate: true },
);
/** 这一块到底走不走打字机：本块锁存过开关，且不是「重放出来的最终正文」 */
const typewriterActive = computed(() => typewriterLatched.value && !replayedAsFinished.value);
/**
 * 落定动效是否开启：显式传了 settle 就听 prop 的；没传则维持原口径
 * （打字机逐字揭示期间关掉，打完字 / 非打字机场景才开）。
 */
const settleEnabled = computed(() =>
  props.settle === null ? !typewriterActive.value : props.settle,
);
const { visible, typing } = useTypewriter(() => props.content, {
  enabled: () => typewriterActive.value,
});

/**
 * 通道一：把「这一块还在逐字揭示」用事件上报给上层（AiContentBlocks 汇总成 typingMap）。
 *
 * 用途：表格 / 图表块要等它前面的正文打完字再出现（见 AiContentBlocks 的媒体闸门）。
 * 流式时后端先推正文、再推表格事件，打字机还落后一大截，表格却已经渲染在正文下方 ——
 * 用户看到的就是「文字还在一个字一个字往外长，表格已经摆好了」。
 *
 * 这一条走查过的 map（按 block.id 逐块记），和下面的计数通道各管一段，别互相替代：
 * 闸门要判断「某一块前面还有没有字在打」，只有 id 维度能做到。
 */
watch(typing, value => emit("typing", Boolean(value)));
// 初始态等挂载后再补一条：setup 阶段就往上抛会在父组件渲染途中改状态
onMounted(() => emit("typing", Boolean(typing.value)));
// 卸载时补一条 false：否则压着后续媒体块的那条「还在打字」永远不会解除
onBeforeUnmount(() => emit("typing", false));

/**
 * 通道二：上报「正文还在逐字」给气泡（见 ai-bubble-v2 的 provide）：选项类块据此延后出现，
 * 保证「正文打完 → 选项出现」的节奏。计数而不是布尔，多段正文各自独立。
 * 卸载时补一次减一，避免打字中途被卸载留下残值让选项一直不出现。
 *
 * **必须 immediate**：useTypewriter 的 watch(source, sync, { immediate: true }) 在 setup 阶段
 * 就把 typing 置成 true，等这里再注册普通 watch 时那一次变化已经过去了 —— 计数停在 0，
 * 选项类块（追问卡 / 推荐问题）会和正文同一帧摆出来，正好是「正文才吐两行，选项已经冒出来」。
 *
 * 用本地标记记住「有没有把自己算进计数」，而不是卸载时再看 typing：
 * 卸载阶段的 stop() 会先把 typing 置回 false，而这次变化对应的 watch 回调随组件销毁被丢弃，
 * 看 typing 会漏减、留下残值，那条消息的选项就再也不出现了。
 */
const typingReporter = inject<Ref<number> | null>("ai-bubble-answer-typing", null);
let reportedTyping = false;
watch(typing, (on) => {
  if (!typingReporter || on === reportedTyping) return;
  reportedTyping = on;
  typingReporter.value = Math.max(0, typingReporter.value + (on ? 1 : -1));
}, { immediate: true });
onBeforeUnmount(() => {
  if (!typingReporter || !reportedTyping) return;
  reportedTyping = false;
  typingReporter.value = Math.max(0, typingReporter.value - 1);
});
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <!-- 打字机还在吐字时按流式交给 markdown：走它自己的节流，不会每帧重排。
         打字机开着就关掉落定动效（settle）：逐字揭示时可见文本每 40ms 变一次，
         落定动画会被反复打断重启，观感就是文字抖动。
         这里跟 typewriterActive 而不是 typewriterEnabled：生成结束会让后者变 false，
         而打字机可能还在吐最后一段（开关已锁存），此时仍不该启动落定 -->
    <MarkdownRenderer
      :content="visible"
      :streaming="streaming || typing"
      :settle="settleEnabled"
    />
  </view>
</template>

<style lang="scss" scoped>
/**
 * 回答正文直接铺在页面底上：不再给灰底卡片 / 圆角 / 内边距。
 * 之前这里是 #F9F9F9 + 20rpx 圆角 + 24/32rpx padding，气泡里就多出一块
 * 与正文不等高的底色块（浅色下白底、深色下暗底），文字还会被 padding 往里推、
 * 与同一条回答的其它块（角色列表、追问卡）左边缘对不齐。
 * 嵌入态（answer-group 内 / 无 answer-group）与独立态保持完全一致。
 */
.answer-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
</style>
