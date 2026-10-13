<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import gsap from 'gsap';
import type { SiteConfig } from '../api/types';

const props = defineProps<{ config: SiteConfig }>();

const heroEl = ref<HTMLElement | null>(null);
const ctx = ref<gsap.Context | null>(null);
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 徽标条：自选游戏分组（写死即可，后端配置驱动）
const badgeGames = computed(() => props.config.games.filter((g) => g.consult).map((g) => g.name));
const tags = computed(() => {
  const t: string[] = ['三角洲行动', '无畏契约', 'CS2'];
  badgeGames.value.forEach((n) => { if (!t.includes(n)) t.push(n); });
  return t;
});

function go(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const stats = [
  { v: '48h', k: '正常交付' },
  { v: '4K', k: '超分画质' },
  { v: 'OCR', k: '截图自动核验' },
];

onMounted(() => {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('.hero-eyebrow', { y: 18, opacity: 0, duration: 0.55 }, 0.15)
    .from('.hero-title-line', { y: 26, opacity: 0, stagger: 0.08, duration: 0.7 }, 0.28)
    .from('.hero-sub', { y: 16, opacity: 0, duration: 0.6 }, 0.62)
    .from('.hero-actions', { y: 12, opacity: 0, duration: 0.5 }, 0.78)
    .from('.hero-stats', { y: 22, opacity: 0, duration: 0.6 }, 0.9)
    .from('.hero-tags', { y: 12, opacity: 0, duration: 0.5 }, 1.02);
  if (prefersReduced) tl.progress(1);

  // 斜切光带微扫
  const sheen = document.querySelector('.hero-sheen');
  if (sheen && !prefersReduced) {
    gsap.to(sheen, { xPercent: 70, duration: 1.1, ease: 'power2.inOut', delay: 1.5, repeat: -1, repeatDelay: 4.5 });
  }
});

onUnmounted(() => ctx.value?.revert());
</script>

<template>
  <section ref="heroEl" id="hero" class="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden">
    <!-- 斜切光带（装饰） -->
    <div class="hero-sheen absolute inset-y-0 -left-2/3 w-2/5 rotate-[14deg] opacity-[0.06] pointer-events-none"
         style="background:linear-gradient(90deg,transparent,#8B7BFF,transparent)" />

    <div class="max-w-6xl mx-auto px-4 relative">
      <div class="max-w-3xl">
        <div class="hero-eyebrow inline-flex items-center gap-2 mb-6">
          <span class="chip chip--accent"><span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background:var(--color-primary-400)"></span>XiCheng Studio · 自助下单</span>
        </div>

        <h1 class="font-display font-bold leading-[1.06] tracking-tight text-[42px] sm:text-6xl md:text-7xl">
          <span class="hero-title-line block">游戏高光，</span>
          <span class="hero-title-line block gradient-text">剪成大片。</span>
        </h1>

        <p class="hero-sub mt-6 max-w-xl text-base md:text-lg" style="color:var(--color-txt-dim)">
          三角洲行动 / 无畏契约 / CS2 集锦剪辑。实时计价、扫码付款、截图自动核验，<b style="color:var(--color-txt)">先付后剪、48h 出片</b>，全程自助无需等客服。
        </p>

        <div class="hero-actions mt-9 flex flex-wrap items-center gap-3">
          <button class="btn btn--primary px-6 py-3 text-[15px]" @click="go('wizard')">
            开始制作
          </button>
          <button class="btn px-5 py-3" @click="go('pricing')">查看价目</button>
        </div>

        <div class="hero-stats mt-12 grid grid-cols-3 gap-4 max-w-md">
          <div v-for="(s, i) in stats" :key="i" class="flex flex-col gap-0.5">
            <span class="font-display font-bold text-2xl md:text-3xl gradient-text">{{ s.v }}</span>
            <span class="text-xs" style="color:var(--color-txt-mute)">{{ s.k }}</span>
          </div>
        </div>

        <div class="hero-tags mt-8 flex flex-wrap gap-2">
          <span v-for="(t, i) in tags" :key="i" class="chip">{{ t }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gradient-text {
  background: linear-gradient(96deg, #C7BFFE, #8B7BFF 52%, #6F5DF0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
</style>