<script setup lang="ts">
import { onMounted, provide, ref } from 'vue';
import { api } from './api/client';
import type { SiteConfig } from './api/types';
import SiteNav from './components/SiteNav.vue';
import HeroSection from './components/HeroSection.vue';
import PriceSection from './components/PriceSection.vue';
import FlowSection from './components/FlowSection.vue';
import WizardSection from './components/WizardSection.vue';
import TrackSection from './components/TrackSection.vue';
import NoticeSection from './components/NoticeSection.vue';
import FooterSection from './components/FooterSection.vue';

const config = ref<SiteConfig | null>(null);
const loadError = ref('');
const loading = ref(true);

// 全局提示
const toastMsg = ref('');
const toastType = ref<'ok' | 'bad' | ''>('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string, type: 'ok' | 'bad' | '' = '') {
  toastMsg.value = msg;
  toastType.value = type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ''; toastType.value = ''; }, 3200);
}
provide('toast', toast);

onMounted(async () => {
  try {
    config.value = await api.config();
  } catch (e: any) {
    loadError.value = e?.message || '配置加载失败';
  } finally {
    loading.value = false;
  }
});

</script>

<template>
  <div class="bg-scene min-h-screen">
    <div class="relative z-10">
      <!-- 顶部导航 -->
      <SiteNav v-if="config" :config="config" />

      <!-- Hero -->
      <HeroSection v-if="config" :config="config" />

      <!-- 价目表 -->
      <PriceSection v-if="config" :config="config" />

      <!-- 流程说明 -->
      <FlowSection v-if="config" />

      <!-- 下单向导 -->
      <WizardSection v-if="config" :config="config" />

      <!-- 查单 -->
      <TrackSection v-if="config" />

      <!-- 须知/FAQ -->
      <NoticeSection v-if="config" :config="config" />

      <!-- 页脚 -->
      <FooterSection v-if="config" :config="config" />

      <!-- 加载 / 错误 -->
      <div v-if="loading" class="flex items-center justify-center min-h-screen">加载中…</div>
      <div v-else-if="loadError" class="flex flex-col items-center justify-center min-h-screen gap-3">
        <p class="text-danger">⚠ {{ loadError }}</p>
        <p class="text-sm" style="color:var(--color-txt-mute)">请确认后端服务已启动（npm start / start.cmd），并已配置 API 代理</p>
      </div>
    </div>

    <!-- 全局 Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed left-1/2 -translate-x-1/2 bottom-6 z-[99]" :class="toastType === 'bad' ? 'toast--bad' : 'toast--ok'">
        <div class="glass px-5 py-3 rounded-xl flex items-center gap-2 shadow-xl">
          <span v-if="toastType === 'ok'" style="color:var(--color-success)">✓</span>
          <span v-else-if="toastType === 'bad'" style="color:var(--color-danger)">✕</span>
          <span class="text-sm">{{ toastMsg }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style>
.toast--ok { border: 1px solid rgba(99, 230, 190, 0.4); }
.toast--bad { border: 1px solid rgba(255, 135, 135, 0.4); }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }

@media (max-width: 760px) {
  .container { padding-left: 1rem; padding-right: 1rem; }
}
</style>