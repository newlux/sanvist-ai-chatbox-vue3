<script setup lang="ts">
import type { AssistantNavigationPayload } from "@/api/chat/types";
import { onMounted, ref } from "vue";

defineOptions({ name: "AssistantNavigationBlock" });

const props = defineProps({
  payload: { type: Object as () => AssistantNavigationPayload, required: true },
});

const emit = defineEmits<{
  open: [payload: AssistantNavigationPayload];
}>();

const hasOpened = ref(false);

onMounted(() => {
  if (hasOpened.value || props.payload.auto_open !== true) return;
  hasOpened.value = true;
  emit("open", props.payload);
});
</script>

<template>
  <view class="assistant-navigation-trigger" />
</template>

<style lang="scss" scoped>
.assistant-navigation-trigger { display: none; }
</style>
