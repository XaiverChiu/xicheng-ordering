<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { SiteConfig } from '../api/types';

defineProps<{ config: SiteConfig }>();

const scrolled = ref(false);
const menuOpen = ref(false);

function onScroll() {
  scrolled.value = window.scrollY > 24;
}
function go(id: string) {
  menuOpen.value = false;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header
    class="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
    :class="scrolled ? 'py-2' : 'py-4'"
  >
    <div class="max-w-6xl mx-auto px-4">
      <nav
        class="flex items-center justify-between px-4 rounded-xl transition-all duration-300"
        :class="scrolled ? 'glass shadow-card py-2' : 'py-2'"
      >
        <button class="flex items-center gap-2.5" @click="go('hero')">
          <img src="/log.jpg" alt="XiCheng" class="w-8 h-8 rounded-lg object-cover ring-1 ring-[color:var(--color-line-strong)]" />
          <span class="font-display font-bold tracking-[0.18em] text-[15px]">XICHENG</span>
        </button>

        <div class="hidden md:flex items-center gap-1 text-sm" style="color:var(--color-txt-dim)">
          <button v-for="(item, i) in [
            { id: 'pricing', label: '价目' },
            { id: 'flow', label: '流程' },
            { id: 'wizard', label: '自助下单' },
            { id: 'track', label: '查进度' },
            { id: 'notice', label: '须知' },
          ]" :key="i" class="px-3 py-1.5 rounded-lg hover:bg-white/5 hover:text-[color:var(--color-txt)] transition-colors" @click="go(item.id)">
            {{ item.label }}
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button class="btn btn--primary btn--sm hidden md:inline-flex" @click="go('wizard')">立即下单</button>
          <button class="md:hidden p-2 rounded-lg hover:bg-white/5" @click="menuOpen = !menuOpen" aria-label="菜单">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line v-if="!menuOpen" x1="3" y1="7" x2="21" y2="7" />
              <line v-if="!menuOpen" x1="3" y1="12" x2="21" y2="12" />
              <line v-if="!menuOpen" x1="3" y1="17" x2="21" y2="17" />
              <line v-if="menuOpen" x1="5" y1="5" x2="19" y2="19" />
              <line v-if="menuOpen" x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        </div>
      </nav>

      <!-- 移动端菜单 -->
      <Transition name="drop">
        <div v-if="menuOpen" class="md:hidden mt-2 glass rounded-xl p-2 shadow-card">
          <button v-for="(item, i) in [
            { id: 'pricing', label: '价目' },
            { id: 'flow', label: '流程' },
            { id: 'wizard', label: '自助下单' },
            { id: 'track', label: '查进度' },
            { id: 'notice', label: '须知' },
          ]" :key="i" class="block w-full text-left px-4 py-2.5 rounded-lg text-sm hover:bg-white/5" @click="go(item.id)">
            {{ item.label }}
          </button>
        </div>
      </Transition>
    </div>
  </header>
</template>

<style scoped>
.drop-enter-active, .drop-leave-active { transition: all 0.2s ease; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-6px); }
</style>