<script setup>
import MarkdownIt from "markdown-it";
import { computed } from "vue";

defineOptions({ name: "MarkdownBlock" });
const props = defineProps({
  content: { type: String, default: "" },
});
const markdown = new MarkdownIt({ html: true, breaks: true, linkify: true });

const html = computed(() => markdown.render(props.content || ""));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-text-v-html-on-component -->
  <view class="markdown-block markdown-body" v-html="html" />
</template>

<style lang="scss" scoped>
.markdown-block { width: 100%; }
.markdown-body { color: #2f323c; font-size: 28rpx !important; line-height: 42rpx; background: transparent; word-break: break-word; }
.markdown-body ::v-deep p { margin: 0 0 12rpx; }
.markdown-body ::v-deep p:last-child { margin-bottom: 0; }
.markdown-body ::v-deep ul, .markdown-body ::v-deep ol { margin: 0; padding-left: 34rpx; }
.markdown-body ::v-deep pre { margin: 8rpx 0; padding: 16rpx; border-radius: 12rpx; background: #fff; overflow: auto; }
.markdown-body ::v-deep table { width: 100%; border-collapse: collapse; font-size: 24rpx; background: #fff; }
.markdown-body ::v-deep th, .markdown-body ::v-deep td { padding: 10rpx 12rpx; border: 1px solid #e4e9f0; text-align: left; vertical-align: top; }
</style>
