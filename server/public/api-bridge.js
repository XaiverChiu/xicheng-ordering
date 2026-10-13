/* ============================================================
   XiCheng 前端 ←→ 后端 桥接层
   由后端在返回 index.html 时自动注入（见 src/server.js）。
   作用：把页面里写死的 localStorage 订单存储，换成真实 API 调用，
   同时保留设计稿原有的渲染代码，不修改设计文件本身。
   ============================================================ */
(function () {
  'use strict';

  var API = '';
  var badge = null;
  var CONFIG = null;
  var ordersCache = [];
  var GAME_KEY_BY_NAME = {};
  var GAME_KEY_BY_PKG_NAME = {};

  /* ---------------- 小工具 ---------------- */
  function log() {
    if (window.__XC_DEBUG) console.log.apply(console, ['[xc]'].concat([].slice.call(arguments)));
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('zh-CN', { hour12: false });
    } catch (e) { return String(iso); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, options) {
    var opt = options || {};
    var init = {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json' },
    };
    if (opt.token) init.headers.authorization = 'Bearer ' + opt.token;
    if (opt.body !== undefined) init.body = JSON.stringify(opt.body);
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: { code: 'BAD_RESPONSE', message: '服务返回格式异常（HTTP ' + res.status + '）' } };
      }).then(function (json) {
        if (!res.ok || json.ok === false) {
          var msg = (json && json.error && json.error.message) || ('请求失败（HTTP ' + res.status + '）');
          var err = new Error(msg);
          err.code = json && json.error && json.error.code;
          throw err;
        }
        return json.data === undefined ? json : json.data;
      });
    });
  }
  function toast(msg, type) {
    try { if (typeof window.toast === 'function') window.toast(msg, type || ''); } catch (e) {}
  }

  /* ---------------- 状态映射 ---------------- */
  var BADGE = {
    wait: { label: '排队中 · 待确认付款', cls: 'wait', track: 1 },
    paid: { label: '已付款 · 待开始', cls: 'run', track: 2 },
    doing: { label: '剪辑中', cls: 'run', track: 2 },
    done: { label: '已完成 · 已交付', cls: 'ok', track: 3 },
    canceled: { label: '已取消', cls: 'wait', track: 0 },
  };

  /** 后端订单 → 页面渲染用的订单对象 */
  function fromApi(o) {
    var b = BADGE[o.status] || BADGE.wait;
    // 费用明细：单价 × 数量 + 超时长 + 4K
    var parts = ['¥' + o.unitPrice + ' × ' + o.quantity + esc(o.unit)];
    if (o.overtimeUnits > 0) parts.push('超时长 ' + o.overtimeUnits + ' 分钟 +¥' + o.overtimeAmount);
    if (o.upscale4k) parts.push('4K 超分 +¥' + o.upscaleAmount);
    if (o.rush) parts.push('加急（另议）');
    return {
      no: o.orderNo,
      game: o.gameName,
      pkg: o.pkgName,
      mode: o.pricingMode,
      duration: o.quantity,
      unit: o.unit,
      total: o.totalAmount,
      paid: o.paidAmount,
      breakdown: parts.join('，'),
      contact: o.contact,
      note: o.requirement || '',
      link: o.refLink || '',
      up4k: !!o.upscale4k,
      rush: !!o.rush,
      music: o.music === 'self' ? '我自备音乐' : '剪辑师自选',
      material: o.material === 'ready' ? '素材已准备好' : '稍后提供素材',
      status: b.cls === 'ok' ? 'done' : b.cls === 'run' ? 'run' : 'wait',
      rawStatus: o.status,
      statusLabel: o.statusLabel || b.label,
      dueAt: o.dueAt,
      createdAt: o.createdAt,
      ts: o.createdAt ? new Date(o.createdAt).getTime() : Date.now(),
      requirement: o.requirement || '',
      adminNote: o.adminNote || '',
    };
  }

  /** 页面下单草稿 → 后端下单入参 */
  function toApiOrder(o) {
    // 首选页面直接给出的 key/id（不做中文名反查，避免名称改动导致错单）
    var sel = window.__XC_SELECT || {};
    var gameKey = sel.game || GAME_KEY_BY_NAME[o.game] || 'delta';
    var pkgId = sel.pkg || null;

    // 兜底：按规格名在服务端配置里反查
    if (!pkgId && CONFIG && CONFIG.games) {
      for (var i = 0; i < CONFIG.games.length; i++) {
        var g = CONFIG.games[i];
        if (g.key !== gameKey) continue;
        for (var j = 0; j < g.packages.length; j++) {
          if (g.packages[j].name === o.pkg) pkgId = g.packages[j].id;
        }
      }
    }
    if (!pkgId) {
      var fallback = { delta: 'd-normal', valorant: 'v-normal' }[gameKey] || 'd-normal';
      pkgId = fallback;
      log('未能确定规格 id，回退到', pkgId, o);
    }
    return {
      game: gameKey,
      pkg: pkgId,
      duration: o.duration || 1,
      contact: o.contact,
      payRef: o.payRef || '',
      payNo: o.payNo || '',
      up4k: !!o.up4k,
      rush: !!o.rush,
      music: /自选/.test(o.music || '') ? 'pro' : 'self',
      material: /稍后/.test(o.material || '') ? 'later' : 'ready',
      link: o.link || '',
      note: o.note || '',
    };
  }

  /* ---------------- 界面状态条 ---------------- */
  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'xc-api-badge';
    badge.style.cssText = [
      'position:fixed', 'left:20px', 'bottom:20px', 'z-index:80',
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:9px 14px', 'border-radius:999px', 'font-size:12.5px', 'font-weight:600',
      'border:1px solid rgba(255,255,255,.16)', 'background:rgba(14,20,32,.92)',
      'color:#98A6B8', 'backdrop-filter:blur(12px)', 'box-shadow:0 18px 40px -22px #000',
      'font-family:inherit', 'line-height:1', 'cursor:default', 'user-select:none',
    ].join(';');
    badge.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#FFB443;box-shadow:0 0 8px #FFB443"></span><span>正在连接服务…</span>';
    document.body.appendChild(badge);
    return badge;
  }
  function setBadge(state, text, detail) {
    var b = ensureBadge();
    var color = state === 'ok' ? '#34D399' : state === 'bad' ? '#FF3D7F' : '#FFB443';
    b.innerHTML =
      '<span style="width:7px;height:7px;border-radius:50%;background:' + color + ';box-shadow:0 0 8px ' + color + '"></span>' +
      '<span>' + esc(text) + '</span>' +
      (detail ? '<span style="color:#66748A">· ' + esc(detail) + '</span>' : '');
  }

  /* ---------------- 同步订单缓存 ---------------- */
  /**
   * 拉取当前客户的订单（用于本地展示缓存）。
   * 查询接口必须带条件，没有条件时直接返回空，避免发出必然 404 的请求。
   */
  function syncFromApi() {
    var q = window.__XC_CONTACT || '';
    if (!q) {
      try { q = localStorage.getItem('xc_last_query') || ''; } catch (e) { q = ''; }
    }
    if (!q) return Promise.resolve([]);
    return api('/api/public/track?q=' + encodeURIComponent(q))
      .then(function (d) { return d.orders || []; })
      .catch(function () { return []; });
  }

  function rememberQuery(q) {
    window.__XC_CONTACT = q;
    try { localStorage.setItem('xc_last_query', q); } catch (e) {}
  }

  /** 用真实配置覆盖前端的价目表数据（价格以后端为准） */
  function applyConfig(cfg) {
    CONFIG = cfg;
    GAME_KEY_BY_NAME = {};
    GAME_KEY_BY_PKG_NAME = {};
    (cfg.games || []).forEach(function (g) {
      GAME_KEY_BY_NAME[g.name] = g.key;
    });
    // 页面里的 GAMES 是顶层 const，不能重新赋值，但可以原地改写内容
    try {
      var games = pageRef('GAMES');
      if (games && typeof games === 'object') {
        Object.keys(games).forEach(function (k) {
          var g = games[k];
          var remote = (cfg.games || []).filter(function (x) { return x.key === k; })[0];
          if (!remote) return;
          g.name = remote.name;
          if (remote.title) g.title = remote.title;
          if (remote.sub !== undefined) g.sub = remote.sub;
          if (remote.packages && remote.packages.length) {
            g.packages = remote.packages.map(function (p) {
              return {
                id: p.id, name: p.name, price: p.price, unit: p.unit,
                chip: p.chip, mode: p.mode, desc: p.desc, flag: p.flag,
              };
            });
          }
        });
        var renderPrice = pageRef('renderPrice');
        var renderQuick = pageRef('renderQuick');
        if (typeof renderPrice === 'function') renderPrice();
        if (typeof renderQuick === 'function') renderQuick();
      }
    } catch (e) {
      log('应用价目表失败', e);
    }
  }

  /* ---------------- 劫持提交与查询 ---------------- */
  /**
   * 注意：页面脚本里的 draft / openOrder / submitOrder 等是「顶层 const / function」，
   * 它们存在于全局词法环境，但不是 window 的属性。
   * 因此这里必须用 typeof 裸标识符判断，不能写 window.draft。
   */
  function pageRef(name) {
    if (Object.prototype.hasOwnProperty.call(window, name)) return window[name];
    try {
      // 兜底：某些页面可能只声明了顶层 const（不在 window 上）
      // eslint-disable-next-line no-eval
      var v = (0, eval)(name);
      return v === undefined ? null : v;
    } catch (e) {
      return null;
    }
  }

  function patchSubmit() {
    if (typeof window.submitOrder !== 'function') return;
    var original = window.submitOrder;
    window.submitOrder = function () {
      var payload;
      try {
        payload = toApiOrder(pageRef('draft') || {});
      } catch (e) {
        toast('下单参数异常，请刷新页面重试', 'bad');
        return;
      }
      if (!payload.contact) { toast('请先填写联系方式', 'bad'); return; }
      if (!payload.payRef || String(payload.payRef).trim().length < 4) {
        toast('请先填写付款备注号（至少 4 位）', 'bad');
        return;
      }
      if (!payload.payNo || !/^[0-9A-Za-z]{10,64}$/.test(String(payload.payNo).trim())) {
        toast('请填写正确的转账单号（10 位以上数字/字母）', 'bad');
        return;
      }
      var shotInput = document.getElementById('fPayShot');
      var shotFile = shotInput && shotInput.files && shotInput.files[0];
      if (!shotFile) { toast('请上传付款截图（转账后的账单详情截图）', 'bad'); return; }
      if (shotFile.size > 5 * 1024 * 1024) { toast('付款截图不能超过 5MB', 'bad'); return; }

      var btn = document.getElementById('wNext');
      var oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '提交核验中…'; }

      // multipart 表单：业务字段 + 付款截图，后端 OCR 自动核对
      var fd = new FormData();
      Object.keys(payload).forEach(function (k) { fd.append(k, payload[k] == null ? '' : payload[k]); });
      fd.append('payShot', shotFile, shotFile.name || 'shot.png');

      fetch(API + '/api/public/payment-claims', {
        method: 'POST',
        body: fd,   // fetch 会自动设置 multipart 边界，绝不能手写 content-type
      })
        .then(function (res) {
          return res.json().catch(function () {
            return { ok: false, error: { code: 'BAD_RESPONSE', message: '服务返回格式异常（HTTP ' + res.status + '）' } };
          }).then(function (json) {
            if (!res.ok || json.ok === false) {
              var msg = (json && json.error && json.error.message) || ('请求失败（HTTP ' + res.status + '）');
              var err = new Error(msg);
              err.code = json && json.error && json.error.code;
              throw err;
            }
            return json.data === undefined ? json : json.data;
          });
        })
        .then(function (res) {
          var claim = res.claim;
          var d = pageRef('draft');
          if (d) {
            d.no = claim.claimNo;
            d.saved = claim;              // 页面渲染直接吃后端结构（claimNo/totalAmount）
            d.savedOrder = res.order || null;  // 自动核验通过时会带正式订单
          }
          window.__XC_LAST = claim;
          rememberQuery(payload.contact);
          // 直接进页面成功页（第 6 步）；不能调页面本地的 submitOrderLocal——
          // 它会再造一个假的 XCP-LOCAL- 编号覆盖刚拿到的真编号
          if (typeof window.setStep === 'function') { window.setStep(6); }
          else if (typeof original === 'function') { original(); }
          toast(res.order ? '核对一致，订单已自动生成' : '已提交，正在自动核对付款', 'ok');
          syncFromApi().then(function () {});
        })
        .catch(function (err) {
          toast(err.message || '提交失败，请稍后重试', 'bad');
          log('提交待核对失败', err);
        })
        .then(function () {
          if (btn) { btn.disabled = false; btn.textContent = oldText || '确认提交'; }
        });
    };
  }

  function patchTrack() {
    var btn = document.getElementById('trackBtn');
    var btn2 = document.getElementById('trackBtn2');
    var input = document.getElementById('trackInput');
    var input2 = document.getElementById('trackInput2');

    function run(q, boxSel) {
      var box = document.querySelector(boxSel);
      if (!box) return;
      q = (q || '').trim();
      if (!q) { box.innerHTML = '<div class="empty">请输入订单号或联系方式</div>'; return; }
      box.innerHTML = '<div class="empty">查询中…</div>';
      // 统一查询接口：XCP-（待核对）/ XC-（订单）/ 联系方式 都能查
      api('/api/public/track?q=' + encodeURIComponent(q))
        .then(function (d) {
          var claims = (d.claims || []).map(fromClaim);
          var orders = (d.orders || []).map(fromApi);
          if (!claims.length && !orders.length) throw new Error('没有找到匹配的记录');
          rememberQuery(q);
          ordersCache = d.orders || [];
          box.innerHTML =
            claims.map(renderClaimCard).join('') +
            orders.map(renderOrderCard).join('');
        })
        .catch(function (err) {
          box.innerHTML =
            '<div class="empty">' +
            '<div style="font-size:14px;color:#EAF0F7;margin-bottom:6px">' + esc(err.message || '查询失败') + '</div>' +
            '<div style="font-size:12px">待核对编号形如 XCP-260930-1234，订单号形如 XC-260930-1234；也可用下单时填写的 QQ / 微信查询</div>' +
            '</div>';
        });
    }

    if (btn) btn.onclick = function () { run(input && input.value, '#trackResult'); };
    if (btn2) btn2.onclick = function () { run(input2 && input2.value, '#trackResult2'); };
    if (input) input.onkeydown = function (e) { if (e.key === 'Enter') run(input.value, '#trackResult'); };
    if (input2) input2.onkeydown = function (e) { if (e.key === 'Enter') run(input2.value, '#trackResult2'); };
  }

  /** 待核对记录 → 页面渲染对象 */
  var CLAIM_BADGE = {
    pending: { label: '待核对到账', cls: 'wait' },
    confirmed: { label: '已核对 · 已生成订单', cls: 'ok' },
    rejected: { label: '已驳回', cls: 'run' },
    expired: { label: '已过期', cls: 'wait' },
  };

  function fromClaim(c) {
    var b = CLAIM_BADGE[c.status] || CLAIM_BADGE.pending;
    return {
      claimNo: c.claimNo,
      status: c.status,
      statusLabel: c.statusLabel || b.label,
      badgeCls: b.cls,
      game: c.gameName,
      pkg: c.pkgName,
      mode: c.pricingMode,
      duration: c.quantity,
      unit: c.unit,
      total: c.totalAmount,
      contact: c.contact,
      payRef: c.payRef,
      payNo: c.payNo,
      payShot: c.payShot,
      ocrOk: !!c.ocrOk,
      ocrNote: c.ocrNote || '',
      orderNo: c.orderNo,
      requirement: c.requirement || '',
      reviewNote: c.reviewNote || '',
      createdAt: c.createdAt,
    };
  }

  /** 待核对卡片：这是客户提交付款后最先看到的状态 */
  function renderClaimCard(c) {
    var cls = c.badgeCls || 'wait';
    var auto = c.ocrOk ? '（系统自动核验通过）' : '';
    var steps = [
      { t: '已提交付款信息', s: '单号+截图已上传', act: true },
      { t: '核对付款', s: c.status === 'pending' ? '进行中' : '已完成', act: c.status !== 'pending' },
      { t: '生成订单号 · 开始剪辑', s: c.status === 'confirmed' ? (c.orderNo || '已生成') : '待核对通过', act: c.status === 'confirmed' },
    ];
    var track = steps.map(function (n) {
      return '<div class="node ' + (n.act ? 'act' : '') + '"><b>' + esc(n.t) + '</b><small>' + esc(n.s) + '</small></div>';
    }).join('');

    var lines = [];
    lines.push('<div><span>游戏 / 规格</span><b>' + esc(c.game) + ' · ' + esc(c.pkg) + '</b></div>');
    lines.push('<div><span>计价 / 时长</span><b>' + esc(c.mode) + ' · ' + c.duration + ' ' + esc(c.unit) + '</b></div>');
    lines.push('<div><span>已付金额</span><b class="mono" style="color:var(--lime)">¥' + c.total + '</b></div>');
    lines.push('<div><span>转账单号</span><b class="mono">' + esc(c.payNo || '—') + '</b></div>');
    lines.push('<div><span>付款备注</span><b class="mono">' + esc(c.payRef) + '</b></div>');
    lines.push('<div><span>联系方式</span><b>' + esc(c.contact) + '</b></div>');
    if (c.orderNo) lines.push('<div><span>正式订单号</span><b class="mono" style="color:var(--cyan)">' + esc(c.orderNo) + '</b></div>');
    if (c.ocrNote) lines.push('<div><span>自动核验</span><b style="color:var(--lime)">' + esc(c.ocrNote) + '</b></div>');
    if (c.payShot) lines.push('<div><span>付款截图</span><a href="' + esc(c.payShot) + '" target="_blank" style="color:var(--cyan)">查看截图 ↗</a></div>');

    var hint = '';
    if (c.status === 'pending') {
      hint = '<div class="mini-note" style="margin-top:14px;align-items:center"><span>系统正在自动核对转账单号与付款截图' + (c.ocrNote ? '（' + esc(c.ocrNote) + '）' : '') + '，请耐心等待。</span>' +
        '<button class="btn btn--primary btn--xs" data-gopay="1" style="margin-left:auto">再付款/查看收款码</button></div>';
    } else if (c.status === 'confirmed') {
      hint = '<div class="mini-note" style="margin-top:14px"><span>已核对到账' + auto + '，正式订单号 <b class="mono" style="color:var(--cyan)">' + esc(c.orderNo || '—') + '</b>，已经开始剪辑，48h 内出片。</span></div>';
    } else if (c.status === 'rejected') {
      hint = '<div class="mini-note" style="margin-top:14px"><span>未核对到这笔到账，已被驳回。请确认已付款且单号/截图填写正确，然后联系剪辑师。</span>' +
        '<button class="btn btn--xs" data-contact="1" style="margin-left:auto">联系剪辑师</button></div>';
    }

    return '' +
      '<div class="order" style="border-color:rgba(196,248,42,.28)">' +
        '<div class="head">' +
          '<span class="no">' + esc(c.claimNo) + '</span>' +
          '<span class="badge badge--' + cls + '">' + esc(c.statusLabel) + '</span>' +
          '<span class="chip" style="margin-left:auto;font-size:11.5px">' + esc(fmtTime(c.createdAt)) + '</span>' +
        '</div>' +
        '<div class="meta">' + lines.join('') + '</div>' +
        '<div class="track">' + track + '</div>' +
        hint +
      '</div>';
  }

  /** 用后端数据重绘订单卡片（状态以后端为准，并隐藏仅用于演示的按钮） */
  function renderOrderCard(o) {
    var b = BADGE[o.rawStatus] || BADGE.wait;
    var nodes = [
      { t: '已提交', s: '进入待确认队列' },
      { t: '已付款 · 剪辑中', s: '付款到账后开始' },
      { t: '已交付成品', s: '48h 内出片' },
    ];
    var track = nodes.map(function (n, i) {
      var act = b.track >= i + 1 ? 'act' : '';
      return '<div class="node ' + act + '"><b>' + n.t + '</b><small>' + n.s + '</small></div>';
    }).join('');

    var lines = [];
    lines.push('<div><span>游戏 / 规格</span><b>' + esc(o.game) + ' · ' + esc(o.pkg) + '</b></div>');
    lines.push('<div><span>计价 / 时长</span><b>' + esc(o.mode) + ' · ' + o.duration + ' ' + esc(o.unit) + '</b></div>');
    lines.push('<div><span>费用明细</span><b>' + esc(o.breakdown || '—') + '</b></div>');
    lines.push('<div><span>应付合计</span><b class="mono" style="color:var(--lime)">¥' + o.total + '</b></div>');
    lines.push('<div><span>联系方式</span><b>' + esc(o.contact) + '</b></div>');

    return '' +
      '<div class="order">' +
        '<div class="head">' +
          '<span class="no">' + esc(o.no) + '</span>' +
          '<span class="badge badge--' + b.cls + '">' + esc(b.label) + '</span>' +
          '<span class="chip" style="margin-left:auto;font-size:11.5px">' + esc(fmtTime(o.createdAt)) + '</span>' +
        '</div>' +
        '<div class="meta">' + lines.join('') + '</div>' +
        '<div class="track">' + track + '</div>' +
        (o.rawStatus === 'wait'
          ? '<div class="mini-note" style="margin-top:14px;align-items:center"><span>尚未付款：扫码支付 <b style="color:var(--lime)">¥' + o.total + '</b>，备注写订单号，付完把截图发给剪辑师。</span>' +
            '<button class="btn btn--primary btn--xs" data-gopay="1" style="margin-left:auto">去付款</button></div>'
          : '') +
        (o.dueAt ? '<div class="mini-note" style="margin-top:14px"><span>承诺交付时间：<b style="color:var(--txt)">' + esc(fmtTime(o.dueAt)) + '</b>（付款到账后 48h 内）</span></div>' : '') +
        (o.requirement ? '<div class="mini-note" style="margin-top:8px"><span>剪辑要求：' + esc(o.requirement) + '</span></div>' : '') +
        (o.rush ? '<div class="mini-note" style="margin-top:6px"><span>已勾选加急，请与剪辑师确认加急费用。</span></div>' : '') +
      '</div>';
  }

  /* ---------------- 顶栏加一个后台入口 ---------------- */
  function addAdminEntry() {
    var cta = document.querySelector('.top-cta');
    if (!cta || document.getElementById('xc-admin-link')) return;
    var a = document.createElement('a');
    a.id = 'xc-admin-link';
    a.className = 'btn btn--sm';
    a.href = '/admin';
    a.textContent = '管理后台';
    a.style.textDecoration = 'none';
    cta.insertBefore(a, cta.firstChild);
  }

  function hideDemoButtons() {
    // 设计稿里的「模拟推进状态 / 删除订单」是本地演示用的，接了后端之后
    // 这些操作必须走管理后台，否则会去请求不存在的接口（导致 404）
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var n = e.target.closest('[data-next]');
      if (n) {
        e.preventDefault();
        e.stopPropagation();
        toast('订单状态请在管理后台修改', 'bad');
        return;
      }
      var d = e.target.closest('[data-del]');
      if (d) {
        e.preventDefault();
        e.stopPropagation();
        toast('删除订单请在管理后台操作', 'bad');
        return;
      }
      // 查单结果里的「再付款/查看收款码」：打开下单流程第 4 步
      var g = e.target.closest('[data-gopay]');
      if (g) {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay(document.getElementById('trackOverlay'));
        var openOrderFn = pageRef('openOrder');
        if (typeof openOrderFn === 'function') openOrderFn(4);
        return;
      }
      // 「联系剪辑师」：滚到页脚联系区
      var ct = e.target.closest('[data-contact]');
      if (ct) {
        e.preventDefault();
        e.stopPropagation();
        var el2 = document.querySelector('.site') || document.body;
        window.scrollTo({ top: el2.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
      }
    }, true);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    ensureBadge();
    hideDemoButtons();

    api('/api/public/config')
      .then(function (cfg) {
        applyConfig(cfg);
        addAdminEntry();
        setBadge('ok', '已连接服务', driverHint());
      })
      .catch(function (err) {
        setBadge('bad', '未连接服务', '数据不会保存');
        log('配置加载失败', err);
      });

    patchSubmit();
    patchTrack();

    // 用真实订单替换演示种子数据
    syncFromApi().then(function (list) {
      ordersCache = list;
      try {
        if (list.length) localStorage.setItem('nc_orders', JSON.stringify(list.map(fromApi)));
        else localStorage.removeItem('nc_orders');
      } catch (e) {}
    });
  }

  function driverHint() {
    return '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__XC = {
    api: api,
    fromApi: fromApi,
    refresh: function () { return syncFromApi().then(function (l) { ordersCache = l; return l; }); },
    getOrders: function () { return ordersCache.slice(); },
  };
})();
