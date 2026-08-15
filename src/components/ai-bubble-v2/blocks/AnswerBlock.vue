<script setup>
import MarkdownBlock from "./MarkdownBlock.vue";

defineOptions({ name: "AnswerBlock" });

defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
});
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <MarkdownBlock :content="content" />
  </view>
</template>

<style lang="scss" scoped>
.answer-block {
  background: #F9F9F9;
  border-radius: 20rpx;
  padding: 24rpx 32rpx;
}
.answer-block--embedded {
  padding: 0;
  border-radius: 0;
  background: transparent;
}
.answer-block ::v-deep .markdown-block {
  color: #1a1a1e;
  font-size: 28rpx;
  line-height: 36rpx;

  h1, h2, h3, h4, h5, h6 {
    margin: 20rpx 0 12rpx;
    color: #2f323c;
    font-weight: 600;
    line-height: 1.4;
  }

  h1 { font-size: 40rpx; }
  h2 { font-size: 36rpx; }
  h3 { font-size: 32rpx; }
  h4, h5, h6 { font-size: 28rpx; }

  p {
    margin: 0 0 12rpx;
    color: #2f323c;
    font-size: 28rpx;
    line-height: 42rpx;
  }

  p:last-child { margin-bottom: 0; }

  hr {
    margin: 16rpx 0;
    border: 0;
    border-top: 1px solid #e4e9f0;
  }

  ul, ol {
    margin: 0 0 12rpx;
    padding-left: 34rpx;
  }

  li {
    margin: 4rpx 0;
    line-height: 42rpx;
  }

  table {
    width: 100%;
    margin: 12rpx 0;
    border-collapse: collapse;
    font-size: 24rpx;
    background: #fff;
  }

  th, td {
    padding: 10rpx 12rpx;
    border: 1px solid #e4e9f0;
    text-align: left;
    vertical-align: top;
  }

  th { font-weight: 600; }

  pre {
    margin: 8rpx 0;
    padding: 16rpx;
    border-radius: 12rpx;
    background: #fff;
    overflow: auto;
    font-size: 24rpx;
    line-height: 36rpx;
  }

  code {
    padding: 2rpx 6rpx;
    border-radius: 4rpx;
    background: #f3f5f7;
    font-size: 24rpx;
  }

  pre code {
    padding: 0;
    background: transparent;
  }
}
</style>
