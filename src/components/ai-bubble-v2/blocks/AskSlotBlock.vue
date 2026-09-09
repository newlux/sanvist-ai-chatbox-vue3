<script setup lang="ts">
import type { AskSlotPayload } from "@/api/chat/types";
import { onMounted, ref } from "vue";

defineOptions({ name: "AskSlotBlock" });

const props = defineProps({
  payload: { type: Object as () => AskSlotPayload, required: true },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits<{
  open: [slot: AskSlotPayload];
}>();

const hasOpened = ref(false);

onMounted(() => {
  if (props.loading && !hasOpened.value) {
    hasOpened.value = true;
    emit("open", props.payload);
  }
});
</script>

<template>
  <view class="ask-slot-trigger" />
</template>

<style lang="scss" scoped>
.ask-slot-trigger { display: none; }
</style>
