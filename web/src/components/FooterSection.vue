<script setup lang="ts">
import type { SiteConfig } from '../api/types';

defineProps<{ config: SiteConfig }>();

function go(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
</script>

<template>
  <footer class="pt-16 pb-10 border-t" style="border-color:var(--color-line)">
    <div class="max-w-6xl mx-auto px-4">
      <div class="grid sm:grid-cols-3 gap-8 mb-10">
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2.5">
            <img src="/log.jpg" alt="XiCheng" class="w-7 h-7 rounded-lg object-cover" />
            <span class="font-display font-bold tracking-[0.18em]">XICHENG</span>
          </div>
          <p class="text-xs leading-relaxed" style="color:var(--color-txt-mute)">
            游戏高光剪辑工作室：三角洲行动 / 无畏契约 / CS2 集锦、卡点、特效剪辑。
            先付后剪，截图自动核验，48h 出片。
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-bold tracking-widest mb-1" style="color:var(--color-txt-mute)">导航</span>
          <button v-for="(item, i) in [
            { id: 'pricing', label: '价目' }, { id: 'flow', label: '流程' },
            { id: 'wizard', label: '自助下单' }, { id: 'track', label: '查进度' },
          ]" :key="i" class="text-left text-xs hover:text-[color:var(--color-primary-300)] transition-colors"
             style="color:var(--color-txt-dim)" @click="go(item.id)">{{ item.label }}</button>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-bold tracking-widest mb-1" style="color:var(--color-txt-mute)">联系</span>
          <span class="text-xs" style="color:var(--color-txt-dim)">QQ <b class="font-mono select-all">{{ config.contact.qq }}</b></span>
          <span class="text-xs" style="color:var(--color-txt-dim)">微信 <b class="font-mono select-all">{{ config.contact.wechat }}</b></span>
        </div>
      </div>

      <div class="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-2"
           style="border-color:var(--color-line)">
        <span class="text-xs" style="color:var(--color-txt-mute)">© 2026 XiCheng Studio · 自助下单平台</span>
        <span class="text-xs" style="color:var(--color-txt-mute)">先付后剪 · 截图自动核验 · 48h 交付</span>
      </div>
    </div>
  </footer>
</template>