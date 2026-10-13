<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  modelValue: string | number;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}>(), {
  placeholder: '请选择',
  ariaLabel: '选择一项',
  disabled: false,
});
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const selected = computed(() => props.options.find((o) => String(o.value) === String(props.modelValue)));
const enabledOptions = computed(() => props.options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled));

function selectAt(index: number) {
  const item = props.options[index];
  if (!item || item.disabled) return;
  emit('update:modelValue', item.value);
  open.value = false;
}
function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) activeIndex.value = props.options.findIndex((o) => String(o.value) === String(props.modelValue));
}
function move(delta: number) {
  const list = enabledOptions.value;
  if (!list.length) return;
  const pos = list.findIndex(({ i }) => i === activeIndex.value);
  const next = list[(pos + delta + list.length) % list.length];
  activeIndex.value = next.i;
  root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next.i]?.scrollIntoView({ block: 'nearest' });
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { open.value = false; return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open.value) { open.value = true; activeIndex.value = props.options.findIndex((o) => String(o.value) === String(props.modelValue)); }
    else move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!open.value) toggle(); else selectAt(activeIndex.value);
  } else if (e.key === 'Home' && open.value) {
    e.preventDefault(); activeIndex.value = enabledOptions.value[0]?.i ?? -1;
  } else if (e.key === 'End' && open.value) {
    e.preventDefault(); activeIndex.value = enabledOptions.value[enabledOptions.value.length - 1]?.i ?? -1;
  }
}
function onOutside(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));
</script>

<template>
  <div ref="root" class="app-select" :class="{ 'is-open': open, 'is-disabled': disabled }" @keydown="onKeydown">
    <button
      type="button"
      class="app-select__trigger input"
      :disabled="disabled"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span :class="selected ? 'app-select__value' : 'app-select__placeholder'">{{ selected?.label ?? placeholder }}</span>
      <svg class="app-select__chevron" :class="{ rotated: open }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <Transition name="select-pop">
      <div v-if="open" class="app-select__menu" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="(option, index) in options"
          :key="String(option.value)"
          type="button"
          role="option"
          class="app-select__option"
          :class="{
            'is-selected': String(option.value) === String(modelValue),
            'is-active': index === activeIndex,
            'is-option-disabled': option.disabled,
          }"
          :aria-selected="String(option.value) === String(modelValue)"
          :disabled="option.disabled"
          @mouseenter="activeIndex = index"
          @click="selectAt(index)"
        >
          <span>{{ option.label }}</span>
          <svg v-if="String(option.value) === String(modelValue)" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-select { position: relative; width: 100%; min-width: 0; }
.app-select__trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  text-align: left; cursor: pointer; padding-right: 13px;
}
.app-select__trigger:disabled { opacity: .5; cursor: not-allowed; }
.app-select__placeholder { color: var(--color-txt-mute); }
.app-select__value { color: var(--color-txt); }
.app-select__chevron { flex: none; color: var(--color-txt-mute); transition: transform .18s ease, color .18s ease; }
.app-select__chevron.rotated { transform: rotate(180deg); color: var(--color-primary-300); }
.app-select.is-open .app-select__trigger { border-color: var(--color-accent-line); box-shadow: 0 0 0 3px rgba(139,123,255,.12); }
.app-select__menu {
  position: absolute; z-index: 80; top: calc(100% + 7px); left: 0; right: 0;
  max-height: 260px; overflow-y: auto; padding: 5px;
  border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  background: rgba(19,20,25,.97); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 16px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25);
  transform-origin: top center;
}
.app-select__option {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border: 0; border-radius: 8px; padding: 9px 11px; text-align: left;
  color: var(--color-txt-dim); background: transparent; font: inherit; font-size: 13px;
  cursor: pointer; transition: background .12s ease, color .12s ease;
}
.app-select__option:hover, .app-select__option.is-active { background: rgba(255,255,255,.07); color: var(--color-txt); }
.app-select__option.is-selected { color: var(--color-primary-300); background: rgba(139,123,255,.1); }
.app-select__option.is-selected.is-active { background: rgba(139,123,255,.16); }
.app-select__option.is-option-disabled { opacity: .4; cursor: not-allowed; }
.select-pop-enter-active, .select-pop-leave-active { transition: opacity .14s ease, transform .14s ease; }
.select-pop-enter-from, .select-pop-leave-to { opacity: 0; transform: translateY(-5px) scale(.985); }
</style>
