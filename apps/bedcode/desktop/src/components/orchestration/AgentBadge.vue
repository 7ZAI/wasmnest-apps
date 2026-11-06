<script setup lang="ts">
import AgentIcon from '@/agents/components/AgentIcon.vue'

withDefaults(
  defineProps<{
    cli: string
    name?: string
    role?: string
    size?: number
  }>(),
  { name: '', role: '', size: 16 },
)
</script>

<template>
  <span class="inline-flex items-center gap-1.5 min-w-0">
    <AgentIcon :adapter="cli" :size="size" />
    <span class="truncate text-[calc(11.5px*var(--ui-scale))] text-[var(--text-primary)]">{{
      name || cli
    }}</span>
    <span
      v-if="role"
      class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >{{ role }}</span
    >
  </span>
</template>
