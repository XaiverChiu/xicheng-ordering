<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue';
import type { Game, Quote, SiteConfig } from '../api/types';
import { api, ApiError } from '../api/client';

const props = defineProps<{ config: SiteConfig }>();
const toast = inject('toast') as (msg: string, type?: 'ok' | 'bad' | '') => void;

// ---------- 步骤 ----------
const STEPS = ['选规格', '填需求', '确认并付款', '上传截图', '提交'];
const step = ref(0);

// ---------- 第 1 步：规格 ----------
const gameKey = ref(props.config.games.find((g) => !g.consult)?.key || 'delta');
const pkgId = ref('');
const duration = ref(1);
const up4k = ref(false);
const game = computed(() => props.config.games.find((g) => g.key === gameKey.value));
const pkg = computed(() => game.value?.packages.find((p) => p.id === pkgId.value));
const unit = computed(() => pkg.value?.unit || '分钟');
const opts = computed(() => {
  const g = props.config.games.find((x) => x.key === gameKey.value);
  const p = g?.packages.find((x) => x.id === pkgId.value);
  return p?.unit === '回合' ? props.config.rounds : props.config.durations;
});

// ---------- 第 2 步：需求 ----------
const music = ref('');
const material = ref('');
const refLink = ref('');
const requirement = ref('');
const contact = ref('');

// ---------- 第 3 步：付款 ----------
const quote = ref<Quote | null>(null);
const quoteLoading = ref(false);
const showQr = ref(false);
const qrTab = ref<'wechat' | 'alipay'>('wechat');
function openQr(tab: 'wechat' | 'alipay' = 'wechat') {
  qrTab.value = tab;
  showQr.value = true;
}

// ---------- 第 4 步：上传截图 ----------
const payNo = ref('');
const shotFile = ref<File | null>(null);
const shotPreview = ref('');
const submitting = ref(false);
const submitError = ref('');
const result = ref<{ claim?: any; order?: any } | null>(null);

// ---------- 试算 ----------
async function calc() {
  if (!pkgId.value) return;
  quoteLoading.value = true;
  try {
    quote.value = await api.quote({
      game: gameKey.value,
      pkg: pkgId.value,
      duration: duration.value,
      up4k: up4k.value,
    });
  } catch (e: unknown) {
    quote.value = null;
    toast(e instanceof ApiError ? e.message : '计价失败', 'bad');
  } finally {
    quoteLoading.value = false;
  }
}

function pickPkg(id: string) {
  pkgId.value = id;
  duration.value = 1;
  quote.value = null;
}
function setGame(g: Game) {
  gameKey.value = g.key;
  pkgId.value = '';
  quote.value = null;
}
function fmt(n: number) {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function canNext(): boolean {
  if (step.value === 0) return !!pkgId.value;
  if (step.value === 2) return !!quote.value;
  if (step.value === 3) return !!payNo.value.trim() && !!shotFile.value;
  return true;
}
function next() {
  if (!canNext()) {
    toast('请先完成当前步骤', 'bad');
    return;
  }
  if (step.value === 0) calc(); // 进入付款步前先计价
  if (step.value === 3) submit();
  else step.value++;
}
function back() {
  if (step.value > 0) step.value--;
}

function onShot(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    toast('截图不能超过 5MB', 'bad');
    input.value = '';
    return;
  }
  shotFile.value = f;
  shotPreview.value = URL.createObjectURL(f);
}

async function submit() {
  if (!shotFile.value || !payNo.value.trim()) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const res = await api.submitClaim(
      {
        game: gameKey.value,
        pkg: pkgId.value,
        duration: duration.value,
        up4k: up4k.value,
        payNo: payNo.value.trim(),
        contact: contact.value.trim(),
        music: music.value,
        material: material.value,
        refLink: refLink.value,
        requirement: requirement.value,
      },
      shotFile.value,
    );
    result.value = res;
    if (res.order) {
      toast('核对一致，订单已自动生成！', 'ok');
    } else {
      toast('已提交，等待人工核对（也可在“查进度”查看）', 'ok');
    }
    step.value = 4;
  } catch (e: unknown) {
    submitError.value = e instanceof ApiError ? e.message : '提交失败，请稍后再试';
  } finally {
    submitting.value = false;
  }
}

function reset() {
  step.value = 0;
  pkgId.value = '';
  quote.value = null;
  payNo.value = '';
  shotFile.value = null;
  shotPreview.value = '';
  result.value = null;
  submitError.value = '';
}

onMounted(calc);
</script>

<template>
  <section id="wizard" class="py-16 md:py-24">
    <div class="max-w-4xl mx-auto px-4">
      <div v-reveal class="text-center max-w-2xl mx-auto mb-12">
        <div class="eyebrow mb-3">Self-Service Order</div>
        <h2 class="font-display font-bold text-3xl md:text-5xl tracking-tight leading-tight">自助下单向导</h2>
        <p class="mt-4" style="color:var(--color-txt-dim)">按步骤完成：选规格 → 填需求 → 付款 → 传截图 → 自动核验出单。</p>
      </div>

      <!-- 步骤条 -->
      <div v-reveal class="flex items-center justify-between mb-10 max-w-lg mx-auto">
        <template v-for="(s, i) in STEPS" :key="s">
          <div class="flex flex-col items-center gap-2 flex-1 min-w-0">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border transition-all duration-300"
              :class="i <= step ? 'bg-[color:var(--color-primary-500)] border-transparent text-white shadow-glow' : 'border-[color:var(--color-line-strong)] text-[color:var(--color-txt-mute)]'"
            >{{ i < step ? '✓' : i + 1 }}</div>
            <span class="text-[11px] whitespace-nowrap" :class="i <= step ? 'text-[color:var(--color-primary-300)]' : 'text-[color:var(--color-txt-mute)]'">{{ s }}</span>
          </div>
          <div v-if="i < STEPS.length - 1" class="h-px flex-1 max-w-8 mb-5" :class="i < step ? 'bg-[color:var(--color-primary-500)]' : 'bg-[color:var(--color-line)]'"></div>
        </template>
      </div>

      <div class="glass card p-5 md:p-8">
        <!-- 完成页 -->
        <div v-if="step === 4 && result" class="text-center py-8">
          <div class="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-2xl mb-5"
               style="background:rgba(99,230,190,0.12);border:1px solid rgba(99,230,190,0.4);color:var(--color-success)">✓</div>
          <h3 class="font-display font-bold text-2xl">
            {{ result.order ? '订单已生成，剪辑师即将接单' : '付款信息已提交' }}
          </h3>
          <p class="mt-3 text-sm" style="color:var(--color-txt-dim)">
            <template v-if="result.order">
              订单号 <b class="font-mono" style="color:var(--color-txt)">{{ result.order.orderNo }}</b> · 已开始排队
            </template>
            <template v-else>
              待核对编号 <b class="font-mono" style="color:var(--color-txt)">{{ result.claim?.claimNo }}</b> · 人工核对后会反馈结果
            </template>
          </p>
          <p class="mt-2 text-xs" style="color:var(--color-txt-mute)">请保存编号，可在「查进度」里随时查看状态。</p>
          <button class="btn btn--primary mt-6" @click="reset">再来一单</button>
        </div>

        <!-- 步骤 0：选规格 -->
        <div v-else-if="step === 0">
          <h3 class="font-bold text-lg mb-5">① 选择游戏与规格</h3>
          <div class="flex flex-wrap gap-2 mb-6">
            <button
              v-for="g in config.games" :key="g.key"
              class="chip cursor-pointer transition-all"
              :class="gameKey === g.key ? 'chip--accent' : ''"
              @click="setGame(g)"
            >{{ g.name }}<span v-if="g.consult" class="text-[10px] opacity-70">询价</span></button>
          </div>

          <div v-if="game?.consult" class="rounded-xl p-5 text-center" style="background:var(--color-accent-soft)">
            <p class="text-sm" style="color:var(--color-primary-300)">该分组为询价服务：请直接联系剪辑师（见页面底部联系方式），按需求报价后下单。</p>
          </div>

          <template v-else>
            <div class="grid sm:grid-cols-2 gap-3 mb-6">
              <button
                v-for="p in game?.packages" :key="p.id"
                class="pkg-item rounded-xl p-4 text-left border transition-all cursor-pointer"
                :class="pkgId === p.id ? 'pkg-on' : 'border-[color:var(--color-line)] hover:border-[color:var(--color-accent-line)]'"
                @click="pickPkg(p.id)"
              >
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-sm">{{ p.name }}</span>
                  <span v-if="p.flag" class="chip chip--accent text-[10px]! px-2 py-0.5">{{ p.flag === 'HOT' ? 'HOT' : '需自备素材' }}</span>
                </div>
                <div class="mt-1 font-display font-bold"><span class="gradient-text">¥{{ fmt(p.price) }}</span><span class="text-xs" style="color:var(--color-txt-mute)"> / {{ p.unit }}</span></div>
                <p class="mt-1 text-xs" style="color:var(--color-txt-mute)">{{ p.desc }}</p>
              </button>
            </div>

            <div v-if="pkg" class="flex flex-wrap items-center gap-2 mb-4">
              <span class="text-sm" style="color:var(--color-txt-dim)">数量：</span>
              <button v-for="d in opts" :key="d" class="chip cursor-pointer transition-all"
                :class="duration === d ? 'chip--accent' : ''" @click="duration = d">{{ d }}{{ unit === '回合' ? '回合' : '分钟' }}</button>
            </div>
            <label class="flex items-center gap-2.5 text-sm cursor-pointer select-none mt-2">
              <input type="checkbox" v-model="up4k" class="w-4 h-4 accent-[color:var(--color-primary-500)]" />
              <span>超分服务解锁 4K 画质</span>
              <span class="text-xs" style="color:var(--color-txt-mute)">+¥15</span>
            </label>
          </template>

          <div class="flex justify-end mt-8">
            <button class="btn btn--primary px-8" :disabled="!pkgId" @click="next">下一步：填需求</button>
          </div>
        </div>

        <!-- 步骤 1：填需求 -->
        <div v-else-if="step === 1">
          <h3 class="font-bold text-lg mb-5">② 填写需求</h3>
          <div class="grid sm:grid-cols-2 gap-5">
            <label class="block">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">配乐</span>
              <select v-model="music" class="input select">
                <option value="">由剪辑师自选</option>
                <option value="指定配乐">指定配乐（请在备注写明歌名）</option>
                <option value="自备素材带BGM">自备素材带 BGM</option>
              </select>
            </label>
            <label class="block">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">素材状态</span>
              <select v-model="material" class="input select">
                <option value="自备素材">自备素材（默认）</option>
                <option value="录屏链接">录屏链接（填下方链接）</option>
                <option value="平台地址">平台地址（B站/抖音主页）</option>
              </select>
            </label>
            <label class="block sm:col-span-2">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">素材链接（可选）</span>
              <input v-model="refLink" class="input" placeholder="https://… 网盘 / 视频链接" />
            </label>
            <label class="block sm:col-span-2">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">详细要求（可选）</span>
              <textarea v-model="requirement" class="input min-h-24 resize-y" placeholder="剪辑节奏、卡点歌曲、字幕风格…没有详细要求则按默认风格制作"></textarea>
            </label>
            <label class="block sm:col-span-2">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">联系方式（查单用，QQ / 微信 / 手机号）</span>
              <input v-model="contact" class="input" placeholder="必填，用于查询订单进度" />
            </label>
          </div>
          <div class="flex justify-between mt-8">
            <button class="btn" @click="back">上一步</button>
            <button class="btn btn--primary px-8" :disabled="!contact.trim()" @click="next">下一步：确认付款</button>
          </div>
        </div>

        <!-- 步骤 2：确认并付款 -->
        <div v-else-if="step === 2">
          <h3 class="font-bold text-lg mb-5">③ 确认并付款 <span class="text-xs font-normal" style="color:var(--color-txt-mute)">先付后剪 · 付款到账后开始剪辑</span></h3>

          <div class="rounded-xl p-5 mb-6 space-y-2 text-sm" style="background:rgba(255,255,255,0.03);border:1px solid var(--color-line)">
            <div class="flex justify-between" style="color:var(--color-txt-dim)"><span>规格</span><span>{{ game?.name }} · {{ pkg?.name }} · {{ duration }}{{ unit }}{{ up4k ? ' · 4K' : '' }}</span></div>
            <div class="flex justify-between" style="color:var(--color-txt-dim)"><span>单价 × 数量</span><span class="tabular-nums">¥{{ fmt(quote?.unitPrice || 0) }} × {{ quote?.qty || 1 }}{{ quote?.unit }}</span></div>
            <div v-if="quote?.overUnit" class="flex justify-between" style="color:var(--color-txt-dim)"><span>超出基准 +{{ quote.overUnit }}{{ quote.unit }}</span><span class="tabular-nums">+¥{{ fmt(quote.over) }}</span></div>
            <div v-if="quote?.up4k" class="flex justify-between" style="color:var(--color-txt-dim)"><span>4K 超分</span><span class="tabular-nums">+¥{{ fmt(quote.up4k) }}</span></div>
            <div class="flex items-center justify-between pt-3 mt-1 border-t" style="border-color:var(--color-line)">
              <span class="font-semibold">应付金额</span>
              <span class="font-display font-bold text-3xl gradient-text tabular-nums" v-if="quote">¥{{ fmt(quote.payable) }}</span>
            </div>
          </div>

          <div class="flex items-center justify-center mb-6">
            <button class="btn btn--primary px-7 py-3" @click="openQr()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M18 18h3v3h-3z"/></svg>
              查看收款码
            </button>
          </div>

          <div class="rounded-xl p-4 text-xs space-y-1" style="background:rgba(255,255,255,0.02);border:1px solid var(--color-line);color:var(--color-txt-mute)">
            <p v-for="(s, i) in config.payment.steps" :key="i">{{ i + 1 }}. {{ s }}</p>
            <p class="pt-1" style="color:var(--color-warning)">⚠ {{ config.payment.note }}</p>
          </div>

          <!-- 收款码弹层：微信 / 支付宝切换 -->
          <Transition name="qr">
            <div v-if="showQr" class="fixed inset-0 z-[60] flex items-center justify-center p-4" style="background:rgba(0,0,0,0.72)" @click.self="showQr = false">
              <div class="glass card p-6 w-full max-w-sm relative" @click.stop>
                <button class="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-sm" @click="showQr = false" aria-label="关闭">✕</button>
                <h4 class="font-bold text-center mb-4">扫码付款 · 长按识别</h4>

                <!-- 微信 / 支付宝 切换 -->
                <div class="grid grid-cols-2 gap-1 p-1 rounded-xl mb-5" style="background:rgba(255,255,255,0.05);border:1px solid var(--color-line)">
                  <button
                    class="py-2 rounded-lg text-sm font-semibold transition-all"
                    :class="qrTab === 'wechat' ? 'bg-[color:var(--color-primary-500)] text-white' : 'text-[color:var(--color-txt-dim)] hover:text-[color:var(--color-txt)]'"
                    @click="qrTab = 'wechat'"
                  >微信支付</button>
                  <button
                    class="py-2 rounded-lg text-sm font-semibold transition-all"
                    :class="qrTab === 'alipay' ? 'bg-[color:var(--color-primary-500)] text-white' : 'text-[color:var(--color-txt-dim)] hover:text-[color:var(--color-txt)]'"
                    @click="qrTab = 'alipay'"
                  >支付宝</button>
                </div>

                <Transition name="qrswap" mode="out-in">
                  <div :key="qrTab" class="text-center">
                    <img
                      :src="qrTab === 'wechat' ? config.payment.wechatQr : config.payment.alipayQr"
                      class="w-52 h-52 mx-auto rounded-xl"
                      style="background:#fff;padding:6px"
                      :alt="qrTab === 'wechat' ? '微信收款码' : '支付宝收款码'"
                    />
                    <p class="text-center text-xs mt-3" style="color:var(--color-txt-dim)">
                      {{ qrTab === 'wechat' ? config.payment.wechatName : config.payment.alipayName }}
                    </p>
                  </div>
                </Transition>

                <p class="text-center text-[11px] mt-4" style="color:var(--color-txt-mute)">
                  支付对应金额后，在「上传截图」步骤填单号并上传截图
                </p>
              </div>
            </div>
          </Transition>

          <div class="flex justify-between mt-8">
            <button class="btn" @click="back">上一步</button>
            <button class="btn btn--primary px-8" :disabled="!quote || quoteLoading" @click="next">
              {{ quoteLoading ? '计价中…' : '我已付款，下一步' }}
            </button>
          </div>
        </div>

        <!-- 步骤 3：上传截图 -->
        <div v-else-if="step === 3">
          <h3 class="font-bold text-lg mb-2">④ 上传付款截图</h3>
          <p class="text-sm mb-6" style="color:var(--color-txt-dim)">填转账单号并上传账单详情截图，系统自动核对（单号 + 金额）后生成订单。</p>

          <div class="grid sm:grid-cols-2 gap-5">
            <label class="block">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">转账单号</span>
              <input v-model="payNo" class="input" placeholder="付款后的转账单号（如 20261013123456）" />
            </label>
            <label class="block">
              <span class="text-sm mb-1.5 block" style="color:var(--color-txt-dim)">付款截图（≤5MB）</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" class="input" @change="onShot" />
            </label>
          </div>

          <div v-if="shotPreview" class="mt-5 flex items-center gap-4 rounded-xl p-4" style="background:rgba(255,255,255,0.03);border:1px solid var(--color-line)">
            <img :src="shotPreview" class="w-24 h-24 object-cover rounded-lg" style="background:#fff" alt="截图预览" />
            <div class="text-sm">
              <p class="font-semibold">{{ shotFile?.name }}</p>
              <p class="text-xs" style="color:var(--color-txt-mute)">{{ (shotFile!.size / 1024 / 1024).toFixed(2) }} MB</p>
            </div>
          </div>

          <p v-if="submitError" class="mt-4 text-sm" style="color:var(--color-danger)">{{ submitError }}</p>

          <div class="flex justify-between mt-8">
            <button class="btn" @click="back">上一步</button>
            <button class="btn btn--primary px-8" :disabled="!canNext() || submitting" @click="next">
              {{ submitting ? '提交核验中…' : '提交并核验' }}
            </button>
          </div>
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
.shadow-glow { box-shadow: var(--shadow-glow); }
.qr-enter-active, .qr-leave-active { transition: opacity 0.2s ease; }
.qr-enter-from, .qr-leave-to { opacity: 0; }
.qrswap-enter-active, .qrswap-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.qrswap-enter-from { opacity: 0; transform: translateY(4px) scale(0.98); }
.qrswap-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>