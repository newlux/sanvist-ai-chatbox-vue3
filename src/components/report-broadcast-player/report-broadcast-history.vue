<script setup lang="ts">
import type { ListenBroadcastHistoryItem } from "@/api/listen-broadcast/types";
import closeIcon from "@/assets/img/voice-assistant/voice-close.svg";
import { useSafeArea } from "@/hooks/useSafeArea";

defineProps<{ loading: boolean; items: ListenBroadcastHistoryItem[]; activeBizDate: string }>();
const emit = defineEmits<{ close: []; select: [item: ListenBroadcastHistoryItem] }>();
const { safeBottomPx } = useSafeArea();
</script>

<template>
  <!-- History Sheet -->
  <view class="report-broadcast-history">
    <view class="report-broadcast-history__mask" @tap="emit('close')" /><view class="report-broadcast-history__sheet">
      <view class="report-broadcast-history__header">
        <text class="report-broadcast-history__title">
          历史播放列表
        </text><image class="report-broadcast-history__close" :src="closeIcon" mode="aspectFit" @tap="emit('close')" />
      </view><view class="report-broadcast-history__tabs">
        <view class="report-broadcast-history__tab report-broadcast-history__tab--active">
          <text>日报</text>
        </view><view class="report-broadcast-history__tab">
          <text>周报</text>
        </view><view class="report-broadcast-history__tab">
          <text>月报</text>
        </view>
      </view><scroll-view class="report-broadcast-history__list" scroll-y>
        <view v-if="loading" class="report-broadcast-history__empty">
          加载中...
        </view><view v-else-if="!items.length" class="report-broadcast-history__empty">
          暂无日报
        </view><view v-for="(item, index) in items" v-else :key="item.bizDate" class="report-broadcast-history__item" :class="{ 'report-broadcast-history__item--selected': activeBizDate ? item.bizDate === activeBizDate : index === 0 }" @tap="emit('select', item)">
          <view class="report-broadcast-history__title-row">
            <text>{{ item.title || '经营概览早报' }}</text><text v-if="index === 0" class="report-broadcast-history__new">
              NEW
            </text>
          </view><text class="report-broadcast-history__date">
            {{ item.bizDate }}
          </text>
        </view>
      </scroll-view><view class="report-broadcast-history__safe-area" :style="{ height: `${safeBottomPx * 2}rpx` }" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-history { position: fixed; z-index: 10; inset: 0; }.report-broadcast-history__mask { position: absolute; inset: 0; background: rgb(0 0 0 / 40%); }.report-broadcast-history__sheet { position: absolute; right: 0; bottom: 0; left: 0; display: flex; height: 910rpx; flex-direction: column; overflow: hidden; border-radius: 48rpx 48rpx 0 0; background: #fff; box-shadow: 0 -8rpx 24rpx rgb(0 0 0 / 8%); }.report-broadcast-history__header { display: flex; height: 128rpx; align-items: center; justify-content: space-between; padding: 0 36rpx 0 52rpx; }.report-broadcast-history__title { color: #666; font-size: 36rpx; font-weight: 500; }.report-broadcast-history__close { width: 60rpx; height: 60rpx; }.report-broadcast-history__tabs { display: flex; height: 82rpx; gap: 12rpx; padding: 0 52rpx; }.report-broadcast-history__tab { display: flex; width: 208rpx; height: 82rpx; align-items: center; justify-content: center; border-radius: 999rpx; background: #f4f3f8; color: #4f4e56; font-size: 32rpx; }.report-broadcast-history__tab--active { background: #191b27; color: #fff; }.report-broadcast-history__list { width: 694rpx; height: 656rpx; align-self: center; padding-top: 44rpx; }.report-broadcast-history__item { display: flex; height: 128rpx; flex-direction: column; justify-content: center; padding: 0 44rpx; gap: 12rpx; }.report-broadcast-history__item--selected { border-radius: 24rpx; background: #f4f3f8; }.report-broadcast-history__title-row { display: flex; gap: 8rpx; color: #1a1a1a; font-size: 28rpx; font-weight: 500; }.report-broadcast-history__new { color: #fe0000; font-size: 22rpx; }.report-broadcast-history__date, .report-broadcast-history__empty { color: #999; font-size: 24rpx; }.report-broadcast-history__empty { display: flex; height: 128rpx; align-items: center; justify-content: center; }.report-broadcast-history__safe-area { flex: 0 0 auto; }
</style>
