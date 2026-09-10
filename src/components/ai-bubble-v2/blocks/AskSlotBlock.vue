<script setup lang="ts">
import type { AskSlotPayload } from "@/api/chat/types";
import { onMounted, ref } from "vue";

defineOptions({ name: "AskSlotBlock" });

const props = defineProps({
  payload: { type: Object as () => AskSlotPayload, required: true },
});

const emit = defineEmits<{
  open: [slot: AskSlotPayload];
}>();

const hasOpened = ref(false);

onMounted(() => {
  if (hasOpened.value || props.payload.auto_open !== true) return;
  hasOpened.value = true;
  emit("open", props.payload);
});
</script>

<template>
  <view class="ask-slot-trigger" />
</template>

<style lang="scss" scoped>
.ask-slot-trigger { display: none; }
</style>
