<script setup lang="ts">
const steps = [
  { n: '01', t: '选游戏规格', d: '三角洲 / 无畏契约 / CS2，选时长与规格，页面即算出应付金额。' },
  { n: '02', t: '扫码付款', d: '微信或支付宝扫收款码付对应金额，付款备注写订单号方便对账。' },
  { n: '03', t: '上传付款截图', d: '在向导内填转账单号、上传付款截图，系统自动核对（单号 + 金额）。' },
  { n: '04', t: '自动生成订单', d: '核对一致立即生成订单并开始排队，剪辑师接单开工。' },
  { n: '05', t: '剪辑交付', d: '48h 内出片交付，交付后可在查单页查看自己的订单状态。' },
];
</script>

<template>
  <section id="flow" class="py-16 md:py-24">
    <div class="max-w-6xl mx-auto px-4">
      <div v-reveal class="max-w-2xl mb-12">
        <div class="eyebrow mb-3">How it works</div>
        <h2 class="font-display font-bold text-3xl md:text-5xl tracking-tight leading-tight">五步完成，全程自助</h2>
        <p class="mt-4" style="color:var(--color-txt-dim)">无需等待客服：选规格 → 付款 → 传截图 → 出单 → 交付，每一步系统都会自动核对与通知。</p>
      </div>

      <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div
          v-for="(s, i) in steps" :key="s.n" v-reveal class="glass card p-5 flex flex-col gap-3 group hover:-translate-y-1 transition-transform duration-300"
        >
          <div class="flex items-center justify-between">
            <span class="font-display font-bold text-2xl gradient-text">{{ s.n }}</span>
            <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
              style="background:var(--color-accent-soft);color:var(--color-primary-300)">{{ i + 1 }}/5</span>
          </div>
          <h3 class="font-bold text-[15px] mt-1">{{ s.t }}</h3>
          <p class="text-xs leading-relaxed" style="color:var(--color-txt-mute)">{{ s.d }}</p>
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