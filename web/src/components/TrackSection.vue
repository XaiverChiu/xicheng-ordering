<script setup lang="ts">
import { ref } from 'vue';
import type { Claim, Order } from '../api/types';
import { api, ApiError } from '../api/client';

const q = ref('');
const loading = ref(false);
const error = ref('');
const claims = ref<Claim[]>([]);
const orders = ref<Order[]>([]);
const searched = ref(false);

const BADGE = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    wait: { label: '排队中 · 待确认付款', cls: 'wait' },
    paid: { label: '已付款 · 待开始', cls: 'run' },
    doing: { label: '剪辑中', cls: 'run' },
    done: { label: '已完成 · 已交付', cls: 'ok' },
    canceled: { label: '已取消', cls: 'wait' },
  };
  return map[s] || { label: s, cls: 'wait' };
};
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
const fmt = (n: number) =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function search() {
  const kw = q.value.trim();
  if (!kw) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await api.track(kw);
    claims.value = res.claims || [];
    orders.value = res.orders || [];
    searched.value = true;
  } catch (e: unknown) {
    error.value = e instanceof ApiError ? e.message : '查询失败';
    claims.value = [];
    orders.value = [];
    searched.value = true;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section id="track" class="py-16 md:py-24">
    <div class="max-w-4xl mx-auto px-4">
      <div v-reveal class="text-center max-w-2xl mx-auto mb-10">
        <div class="eyebrow mb-3">Track order</div>
        <h2 class="font-display font-bold text-3xl md:text-5xl tracking-tight leading-tight">查进度</h2>
        <p class="mt-4" style="color:var(--color-txt-dim)">输入订单号（XC-…）、待核对编号（XCP-…）或下单时的联系方式，即可查看最新状态。</p>
      </div>

      <div v-reveal class="glass card p-5 md:p-6">
        <div class="flex gap-3">
          <input v-model="q" class="input" placeholder="XC-20261013-001 / XCP-… / QQ或微信" @keyup.enter="search" />
          <button class="btn btn--primary px-6 shrink-0" :disabled="!q.trim() || loading" @click="search">
            {{ loading ? '查询中…' : '查询' }}
          </button>
        </div>

        <p v-if="error" class="mt-4 text-sm" style="color:var(--color-warning)">{{ error }}</p>

        <div v-if="searched && !error" class="mt-6 space-y-4">
          <!-- 订单 -->
          <div v-for="o in orders" :key="o.orderNo" class="rounded-xl p-5" style="background:rgba(255,255,255,0.03);border:1px solid var(--color-line)">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span class="font-mono font-bold text-sm">{{ o.orderNo }}</span>
                <span class="ml-3 text-sm" style="color:var(--color-txt-dim)">{{ o.gameName }} · {{ o.pkgName }}</span>
              </div>
              <span class="chip" :class="BADGE(o.status).cls === 'ok' ? 'chip--accent' : ''" :style="BADGE(o.status).cls === 'ok' ? 'border-color:var(--color-accent-line)' : ''">
                {{ BADGE(o.status).label }}
              </span>
            </div>
            <div class="mt-3 grid sm:grid-cols-3 gap-2 text-xs" style="color:var(--color-txt-mute)">
              <div>金额：<b style="color:var(--color-txt)">¥{{ fmt(o.totalAmount) }}</b></div>
              <div>下单：{{ fmtTime(o.createdAt) }}</div>
              <div>交付：<b v-if="o.deliveredAt" style="color:var(--color-success)">{{ fmtTime(o.deliveredAt) }}</b><span v-else>—</span></div>
            </div>
            <div v-if="o.dueAt" class="mt-2 text-xs" style="color:var(--color-txt-mute)">预计 {{ fmtTime(o.dueAt) }} 前交付</div>
          </div>

          <!-- 待核对 -->
          <div v-for="c in claims" :key="c.claimNo" class="rounded-xl p-5" style="background:rgba(255,255,255,0.03);border:1px solid var(--color-line)">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span class="font-mono font-bold text-sm">{{ c.claimNo }}</span>
                <span class="ml-3 text-sm" style="color:var(--color-txt-dim)">{{ c.gameName }} · {{ c.pkgName }}</span>
              </div>
              <span class="chip">{{ c.statusLabel }}</span>
            </div>
            <div class="mt-3 grid sm:grid-cols-2 gap-2 text-xs" style="color:var(--color-txt-mute)">
              <div>金额：<b style="color:var(--color-txt)">¥{{ fmt(c.totalAmount) }}</b></div>
              <div>提交：{{ fmtTime(c.createdAt) }}</div>
            </div>
            <p v-if="c.ocrNote" class="mt-2 text-xs" style="color:var(--color-txt-mute)">核验：{{ c.ocrNote }}</p>
            <p v-if="c.orderNo" class="mt-2 text-xs" style="color:var(--color-success)">已生成订单 {{ c.orderNo }}</p>
          </div>

          <p v-if="searched && !claims.length && !orders.length" class="text-sm text-center py-4" style="color:var(--color-txt-mute)">
            没有查到记录，请检查编号或联系方式。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wait { color: var(--color-txt-mute); }
.run { color: var(--color-primary-300); border-color: var(--color-accent-line); background: var(--color-accent-soft); }
.ok { color: var(--color-success); border-color: rgba(99,230,190,0.4); background: rgba(99,230,190,0.1); }
</style>