<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Game, Quote, SiteConfig } from '../api/types';
import { api, ApiError } from '../api/client';
import AppSelect from './AppSelect.vue';

const props = defineProps<{ config: SiteConfig }>();

const activeKey = ref(props.config.games.find((g) => !g.consult)?.key || 'delta');
const activeGame = computed(() => props.config.games.find((g) => g.key === activeKey.value));

const selPkg = ref('');
const selDuration = ref(1);
const up4k = ref(false);
const quote = ref<Quote | null>(null);
const quoteLoading = ref(false);
const quoteError = ref('');

const selPkgUnit = computed(() => {
  const g = props.config.games.find((x) => x.key === activeKey.value);
  return g?.packages.find((p) => p.id === selPkg.value);
});
const opts = computed(() => {
  const g = props.config.games.find((x) => x.key === activeKey.value);
  const p = g?.packages.find((x) => x.id === selPkg.value);
  return p?.unit === '回合' ? props.config.rounds : props.config.durations;
});

function pickPackage(game: Game) {
  activeKey.value = game.key;
  selPkg.value = '';
  selDuration.value = 1;
  quote.value = null;
  quoteError.value = '';
}

async function calc() {
  if (!selPkg.value) return;
  quoteLoading.value = true;
  quoteError.value = '';
  try {
    quote.value = await api.quote({
      game: activeKey.value,
      pkg: selPkg.value,
      duration: selDuration.value,
      up4k: up4k.value,
    });
  } catch (e: unknown) {
    quoteError.value = e instanceof ApiError ? e.message : '计价失败，请稍后再试';
    quote.value = null;
  } finally {
    quoteLoading.value = false;
  }
}
function fmt(n: number) {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function go(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}
</script>

<template>
  <section id="pricing" class="py-16 md:py-24">
    <div class="max-w-6xl mx-auto px-4">
      <div v-reveal class="max-w-2xl mb-12">
        <div class="eyebrow mb-3">Pricing</div>
        <h2 class="font-display font-bold text-3xl md:text-5xl tracking-tight leading-tight">透明计价，<span class="gradient-text">先算后付</span></h2>
        <p class="mt-4" style="color:var(--color-txt-dim)">选定游戏与规格，页面实时显示应付金额——与下单结算同一套计算逻辑，所见即所得。</p>
      </div>

      <div v-reveal class="flex flex-wrap gap-2 mb-8">
        <button
          v-for="g in config.games" :key="g.key"
          class="chip transition-all cursor-pointer hover:border-[color:var(--color-accent-line)]"
          :class="activeKey === g.key ? 'chip--accent' : ''"
          @click="pickPackage(g)"
        >
          {{ g.name }}
          <span v-if="g.consult" class="text-[10px] opacity-70">询价</span>
        </button>
      </div>

      <div v-if="activeGame" class="grid md:grid-cols-5 gap-6">
        <div v-reveal class="md:col-span-2 glass card p-6 flex flex-col gap-4 h-max">
          <div>
            <h3 class="font-display font-bold text-xl">{{ activeGame.title }}</h3>
            <p class="mt-1 text-sm" style="color:var(--color-txt-mute)">{{ activeGame.sub || '自助下单' }}</p>
          </div>

          <div v-if="activeGame.consult" class="rounded-xl p-4 text-sm" style="background:var(--color-accent-soft);color:var(--color-primary-300)">
            该分组为定制询价：素材要求、时长与价格请直接联系剪辑师，按需报价。
            <div class="mt-3">
              <button class="btn btn--primary btn--sm" @click="go('notice')">联系剪辑师</button>
            </div>
          </div>

          <template v-else>
            <div
              v-for="p in activeGame.packages" :key="p.id"
              class="pkg-item rounded-xl p-4 cursor-pointer border transition-all"
              :class="selPkg === p.id ? 'pkg-on' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-accent-line)]'"
              @click="selPkg = p.id; quote = null"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-sm">{{ p.name }}</span>
                <span v-if="p.flag === 'HOT'" class="chip chip--accent text-[10px]! px-2 py-0.5">HOT</span>
                <span v-else-if="p.flag === 'SELF'" class="chip text-[10px]! px-2 py-0.5">需自备素材</span>
              </div>
              <div class="mt-1 font-display font-bold text-lg">
                <span class="gradient-text">¥{{ fmt(p.price) }}</span>
                <span class="text-xs font-normal" style="color:var(--color-txt-mute)"> / {{ p.unit }}</span>
              </div>
              <p class="mt-1 text-xs" style="color:var(--color-txt-mute)">{{ p.desc }}</p>
            </div>
          </template>
        </div>

        <div v-reveal class="md:col-span-3 glass card p-6 flex flex-col">
          <h4 class="text-sm font-bold tracking-wide mb-4" style="color:var(--color-txt-dim)">快速试算</h4>

          <div v-if="activeGame.consult" class="flex-1 flex flex-col items-center justify-center gap-3 text-center py-10" style="color:var(--color-txt-mute)">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3"/></svg>
            <p class="text-sm">无固定价格 · 按素材与要求报价</p>
          </div>

          <template v-else>
            <div class="flex items-center justify-between gap-3 pb-4 border-b" style="border-color:var(--color-line)">
              <span class="text-sm" style="color:var(--color-txt-mute)">{{ activeGame.title }}</span>
              <AppSelect
                v-model="selPkg"
                class="max-w-[220px]!"
                aria-label="选择规格"
                placeholder="选择规格"
                :options="activeGame.packages.map((p) => ({ label: p.name, value: p.id }))"
                @update:model-value="quote = null"
              />
            </div>

            <div class="py-4 space-y-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm" style="color:var(--color-txt-mute)">{{ selPkgUnit?.unit === '回合' ? '回合数' : '时长' }}</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="d in opts" :key="d" class="chip cursor-pointer transition-all"
                    :class="selDuration === d ? 'chip--accent' : ''"
                    @click="selDuration = d; quote = null"
                  >{{ d }}{{ selPkgUnit?.unit === '回合' ? '回合' : '分钟' }}</button>
                </div>
              </div>
              <label class="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                <input type="checkbox" v-model="up4k" class="w-4 h-4 accent-[color:var(--color-primary-500)]" @change="quote = null" />
                <span>超分服务解锁 4K 画质</span>
                <span class="text-xs" style="color:var(--color-txt-mute)">+¥15</span>
              </label>
            </div>

            <div class="mt-auto pt-3 border-t" style="border-color:var(--color-line)">
              <button class="btn btn--primary w-full py-3" :disabled="!selPkg || quoteLoading" @click="calc">
                {{ quoteLoading ? '计算中…' : '立即试算' }}
              </button>

              <div v-if="quote" class="mt-4 rounded-xl p-4 text-sm space-y-1.5" style="background:rgba(255,255,255,0.03);border:1px solid var(--color-line)">
                <div class="flex justify-between" style="color:var(--color-txt-dim)">
                  <span>单价 × 数量</span><span class="tabular-nums">¥{{ fmt(quote.unitPrice) }} × {{ quote.qty }}{{ quote.unit }}</span>
                </div>
                <div v-if="quote.overUnit > 0" class="flex justify-between" style="color:var(--color-txt-dim)">
                  <span>超出基准 +{{ quote.overUnit }}{{ quote.unit }}</span>
                  <span class="tabular-nums">+¥{{ fmt(quote.over) }}</span>
                </div>
                <div v-if="quote.up4k" class="flex justify-between" style="color:var(--color-txt-dim)">
                  <span>4K 超分</span><span class="tabular-nums">+¥{{ fmt(quote.up4k) }}</span>
                </div>
                <div class="flex items-baseline justify-between pt-2 mt-1 border-t" style="border-color:var(--color-line)">
                  <span class="text-sm">应付<span class="text-xs" style="color:var(--color-txt-mute)">（先付后剪）</span></span>
                  <span class="font-display font-bold text-2xl gradient-text tabular-nums">¥{{ fmt(quote.payable) }}</span>
                </div>
              </div>
              <p v-if="quoteError" class="mt-3 text-sm" style="color:var(--color-danger)">{{ quoteError }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pkg-on {
  border-color: var(--color-accent-line);
  background: var(--color-accent-soft);
  box-shadow: var(--shadow-glow);
}
.gradient-text {
  background: linear-gradient(96deg, #C7BFFE, #8B7BFF 52%, #6F5DF0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
</style>