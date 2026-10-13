<script setup lang="ts">
import { ref } from 'vue';
import type { SiteConfig } from '../api/types';

defineProps<{ config: SiteConfig }>();

const faq = [
  {
    q: '多久能出片？',
    a: '正常 48h 内交付（含特效/卡点）。加急请先联系剪辑师确认排期。',
  },
  {
    q: '为什么是「先付后剪」？',
    a: '平台为个人工作室直营：先付款到账（系统截图自动核验）后开始剪辑，保证剪辑师产能不被白占；也是当前没有商户号时唯一可行的自动对账方式。',
  },
  {
    q: '付款截图怎么上传？',
    a: '在「自助下单」第 4 步填转账单号并上传账单详情截图（≤5MB），系统自动识别单号与金额，一致即生成订单；不一致或识别失败会转人工复核，结果可在「查进度」查看。',
  },
  {
    q: '素材怎么给你？',
    a: '下单时填写链接（网盘 / 视频地址）即可；也可以下单后直接通过 QQ/微信发送给剪辑师，素材格式不限。',
  },
  {
    q: '4K 超分是什么？',
    a: '+15 元的增值服务：把 1080P 素材超分到 4K 画质输出，观感更清晰，适合投屏或上传 4K 平台。',
  },
  {
    q: '成品能修改吗？',
    a: '没有详细要求的成品默认不支持更换；如果下单时写清要求（卡点、字幕、配乐），我们会按你的要求一次做对。',
  },
];

const open = ref<number | null>(0);
function toggle(i: number) {
  open.value = open.value === i ? null : i;
}
</script>

<template>
  <section id="notice" class="py-16 md:py-24">
    <div class="max-w-6xl mx-auto px-4">
      <div class="grid lg:grid-cols-2 gap-8">
        <!-- 须知 -->
        <div v-reveal>
          <div class="eyebrow mb-3">Rules</div>
          <h2 class="font-display font-bold text-3xl md:text-4xl tracking-tight leading-tight mb-6">下单须知</h2>
          <div class="glass card p-6">
            <ul class="space-y-3">
              <li v-for="(n, i) in config.rules.notes" :key="i" class="flex gap-3 text-sm">
                <span class="mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold"
                      style="background:var(--color-accent-soft);color:var(--color-primary-300)">{{ i + 1 }}</span>
                <span style="color:var(--color-txt-dim)">{{ n }}</span>
              </li>
            </ul>
          </div>

          <div class="glass card p-6 mt-4">
            <h3 class="font-bold text-sm mb-3">联系剪辑师</h3>
            <div class="flex flex-col gap-2.5 text-sm">
              <div class="flex items-center gap-3">
                <span class="chip">QQ</span>
                <b class="font-mono select-all">{{ config.contact.qq }}</b>
              </div>
              <div class="flex items-center gap-3">
                <span class="chip">微信</span>
                <b class="font-mono select-all">{{ config.contact.wechat }}</b>
              </div>
            </div>
          </div>
        </div>

        <!-- FAQ -->
        <div v-reveal>
          <div class="eyebrow mb-3">FAQ</div>
          <h2 class="font-display font-bold text-3xl md:text-4xl tracking-tight leading-tight mb-6">常见问题</h2>
          <div class="space-y-3">
            <div v-for="(f, i) in faq" :key="i" class="glass card overflow-hidden">
              <button class="w-full flex items-center justify-between gap-4 p-5 text-left" @click="toggle(i)">
                <span class="font-semibold text-sm">{{ f.q }}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     class="transition-transform duration-300 shrink-0" :class="open === i ? 'rotate-180' : ''"
                     style="color:var(--color-txt-mute)"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <Transition name="acc">
                <div v-if="open === i" class="px-5 pb-5">
                  <p class="text-sm leading-relaxed" style="color:var(--color-txt-dim)">{{ f.a }}</p>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.acc-enter-active, .acc-leave-active { transition: all 0.25s ease; }
.acc-enter-from, .acc-leave-to { opacity: 0; transform: translateY(-4px); }
</style>