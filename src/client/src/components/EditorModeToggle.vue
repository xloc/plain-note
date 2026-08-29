<script setup lang="ts">
import { ArrowLongRightIcon, EyeIcon as SmallEyeIcon, PencilIcon as SmallPencilIcon } from '@heroicons/vue/16/solid'
import { EyeIcon, PencilIcon } from '@heroicons/vue/24/outline'

const previewMode = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    class="rounded-lg bg-stone-100 p-2 text-violet-500 hover:bg-stone-100"
    type="button"
    :title="previewMode ? 'Switch to edit mode' : 'Switch to preview mode'"
    @click="previewMode = !previewMode"
  >
    <span class="relative block size-5">
      <Transition name="mode">
        <component
          :is="previewMode ? EyeIcon : PencilIcon"
          :key="previewMode ? 'preview' : 'edit'"
          class="absolute inset-0 size-5"
        />
      </Transition>
      <span class="absolute -right-1.5 -bottom-1.5 flex items-end text-stone-300">
        <ArrowLongRightIcon class="size-2.5" />
        <span class="relative block size-3">
          <Transition name="next-mode">
            <component
              :is="previewMode ? SmallPencilIcon : SmallEyeIcon"
              :key="previewMode ? 'edit' : 'preview'"
              class="absolute inset-0 size-3"
            />
          </Transition>
        </span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.mode-enter-active,
.mode-leave-active {
  transition:
    opacity 180ms ease-out,
    transform 180ms ease-out;
}

.mode-enter-from {
  opacity: 0;
  transform: translate(0.65rem, 0.5rem) scale(0.6);
}

.mode-leave-to {
  opacity: 0;
  transform: translate(0.65rem, 0.5rem) scale(0.6);
}

.next-mode-enter-active,
.next-mode-leave-active {
  transition:
    opacity 180ms ease-out,
    transform 180ms ease-out;
}

.next-mode-enter-from,
.next-mode-leave-to {
  opacity: 0;
  transform: translate(-0.65rem, -0.5rem) scale(1.67);
}

@media (prefers-reduced-motion: reduce) {
  .mode-enter-active,
  .mode-leave-active,
  .next-mode-enter-active,
  .next-mode-leave-active {
    transition: none;
  }
}
</style>
