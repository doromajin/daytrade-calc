"use strict";
(function () {
  var STOCKS = [
    {ticker:'NVDA', shares:6, cost:0, price:0},
    {ticker:'AVGO', shares:4, cost:0, price:0},
    {ticker:'TSM', shares:2, cost:0, price:0},
    {ticker:'GOOGL', shares:3, cost:0, price:0},
    {ticker:'SPCX', shares:4, cost:135, price:160},
    {ticker:'PLTR', shares:3, cost:0, price:0},
    {ticker:'IONQ', shares:3, cost:0, price:0},
    {ticker:'PPTA', shares:4, cost:0, price:0},
    {ticker:'RKLB', shares:1, cost:0, price:0}
  ];
  var FUNDS = [
    {name:'eMAXIS Slim 全世界株式', short:'オルカン', units:0, nav:20000, monthly:20000},
    {name:'iFreeNEXT FANG+', short:'FANG+', units:0, nav:30000, monthly:20000}
  ];
  var GOAL_25 = 10000000, GOAL_30 = 100000000, CONTRIB_DAY = 12;
  var STORAGE_KEY = 'asset-dashboard-data';
  var CAT_COLORS = { '米国株':'#58a6ff', '投資信託':'#00d4aa', 'iDeCo':'#a78bfa', '現金':'#f0b429' };
  var lastContribMonth = null;
  var currentHistory = [];
  var trendPeriod = 'week';

  function $(id) { return document.getElementById(id); }
  function fmtYen(v) { return '¥' + Math.round(v).toLocaleString('ja-JP'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 履歴を week/month/year で集計。各期間の最後のスナップショットを代表値とする
  function aggregateHistory(hist, period) {
    // 後方互換: 古い {month:'6月'} 形式は date がないのでそのまま月ラベルで扱う
    var buckets = {};
    var order = [];
    hist.forEach(function (h) {
      var key, label;
      if (h.date) {
        var d = new Date(h.date + 'T00:00:00');
        if (period === 'year') {
          key = '' + d.getFullYear();
          label = d.getFullYear() + '年';
        } else if (period === 'week') {
          // ISO週番号
          var tmp = new Date(d.getTime());
          var day = (tmp.getDay() + 6) % 7;
          tmp.setDate(tmp.getDate() - day + 3);
          var firstThu = new Date(tmp.getFullYear(), 0, 4);
          var week = 1 + Math.round(((tmp - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
          key = tmp.getFullYear() + '-W' + pad2(week);
          label = (d.getMonth() + 1) + '/' + d.getDate();
        } else { // month
          key = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
          label = (d.getMonth() + 1) + '月';
        }
      } else {
        key = h.month || '?';
        label = h.month || '?';
      }
      if (!(key in buckets)) order.push(key);
      buckets[key] = {label: label, total: h.total};
    });
    return order.map(function (k) { return buckets[k]; });
  }


  function buildStockInputs() {
    var c = $('us-stock-inputs'); if (!c) return; c.innerHTML = '';
    STOCKS.forEach(function (s, i) {
      var row = document.createElement('div'); row.className = 'input-row';
      row.innerHTML =
        '<label style="width:56px; font-weight:500;">' + s.ticker + '</label>' +
        '<input type="number" data-idx="' + i + '" data-field="shares" value="' + s.shares + '" step="0.0001" style="width:70px;">' +
        '<input type="number" data-idx="' + i + '" data-field="cost" value="' + s.cost + '" step="0.01" placeholder="平均取得$" style="width:100px;">';
      c.appendChild(row);
    });
  }
  function buildFundInputs() {
    var c = $('fund-inputs'); if (!c) return; c.innerHTML = '';
    FUNDS.forEach(function (f, i) {
      var row = document.createElement('div'); row.className = 'fund-grid';
      row.innerHTML =
        '<div class="fund-name" title="' + f.name + '">' + f.name + '</div>' +
        '<input type="number" data-idx="' + i + '" data-field="nav" value="' + f.nav + '" step="1" placeholder="基準価額">' +
        '<input type="number" data-idx="' + i + '" data-field="units" value="' + f.units.toFixed(1) + '" step="0.1" placeholder="保有口数">' +
        '<input type="number" data-idx="' + i + '" data-field="monthly" value="' + f.monthly + '" step="1000" placeholder="月額">';
      c.appendChild(row);
    });
  }
  function attachInputListeners() {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () { syncFromInputs(); render(); });
    }
  }
  function monthKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
  function checkContributionDue() {
    var now = new Date(), key = monthKey(now);
    var msg = $('contribution-msg');
    var btn = $('apply-contribution-btn');
    if (!msg || !btn) return;
    if (lastContribMonth === key) {
      msg.textContent = '今月(' + (now.getMonth() + 1) + '月)の積立は反映済みです。';
      btn.disabled = true;
    } else if (now.getDate() < CONTRIB_DAY) {
      msg.textContent = '積立日(' + CONTRIB_DAY + '日)になると押せるようになります。';
      btn.disabled = true;
    } else {
      msg.textContent = '今月(' + (now.getMonth() + 1) + '月)の積立を反映できます。先に基準価額・iDeCo評価額を更新してから押してください。';
      btn.disabled = false;
    }
  }
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY); if (!raw) return [];
      var d = JSON.parse(raw);
      if (d.apiKey) $('api-key').value = d.apiKey;
      if (d.avApiKey) $('av-api-key').value = d.avApiKey;
      if (d.fx) $('fx-rate').value = (parseFloat(d.fx) || 150).toFixed(2);
      if (d.ideco !== undefined) $('ideco-value').value = d.ideco;
      if (d.idecoMonthly !== undefined) $('ideco-monthly').value = d.idecoMonthly;
      if (d.cash !== undefined) $('cash-value').value = d.cash;
      if (d.stocks) d.stocks.forEach(function (s, i) { if (STOCKS[i]) { STOCKS[i].shares = s.shares; STOCKS[i].cost = s.cost; STOCKS[i].price = s.price; } });
      if (d.funds) d.funds.forEach(function (f, i) { if (FUNDS[i]) { FUNDS[i].units = f.units; FUNDS[i].nav = f.nav; FUNDS[i].monthly = f.monthly; } });
      if (d.lastContribMonth) lastContribMonth = d.lastContribMonth;
      return d.history || [];
    } catch (e) { return []; }
  }
  function saveData() {
    try {
      var d = {
        apiKey: $('api-key').value.trim(),
        avApiKey: $('av-api-key').value.trim(),
        fx: parseFloat($('fx-rate').value) || 150,
        ideco: parseFloat($('ideco-value').value) || 0,
        idecoMonthly: parseFloat($('ideco-monthly').value) || 0,
        cash: parseFloat($('cash-value').value) || 0,
        stocks: STOCKS.map(function (s) { return {shares: s.shares, cost: s.cost, price: s.price}; }),
        funds: FUNDS.map(function (f) { return {units: f.units, nav: f.nav, monthly: f.monthly}; }),
        lastContribMonth: lastContribMonth, history: currentHistory
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch (e) {}
  }
  function syncFromInputs() {
    var si = document.querySelectorAll('#us-stock-inputs input');
    for (var i = 0; i < si.length; i++) { STOCKS[parseInt(si[i].getAttribute('data-idx'), 10)][si[i].getAttribute('data-field')] = parseFloat(si[i].value) || 0; }
    var fi = document.querySelectorAll('#fund-inputs input');
    for (var j = 0; j < fi.length; j++) { FUNDS[parseInt(fi[j].getAttribute('data-idx'), 10)][fi[j].getAttribute('data-field')] = parseFloat(fi[j].value) || 0; }
  }
  function scalars() {
    return {
      fx: parseFloat($('fx-rate').value) || 150,
      ideco: parseFloat($('ideco-value').value) || 0,
      idecoMonthly: parseFloat($('ideco-monthly').value) || 0,
      cash: parseFloat($('cash-value').value) || 0
    };
  }
  function drawDoughnut(canvas, items) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6, ir = r * 0.6;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0);
    if (total <= 0) { ctx.fillStyle = '#30363d'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#0d1117'; ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2); ctx.fill(); return; }
    var start = -Math.PI / 2;
    items.forEach(function (it) {
      if (it.value <= 0) return;
      var ang = it.value / total * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, start + ang); ctx.closePath();
      ctx.fillStyle = it.color; ctx.fill(); start += ang;
    });
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2); ctx.fillStyle = '#0d1117'; ctx.fill();
  }
  function drawLine(canvas, labels, values) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var padL = 50, padR = 12, padT = 12, padB = 24;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var maxV = Math.max.apply(null, values.concat([1])), minV = 0;
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1; ctx.fillStyle = '#8b949e'; ctx.font = '11px sans-serif';
    for (var g = 0; g <= 4; g++) {
      var y = padT + plotH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText('¥' + (maxV * (1 - g / 4) / 1000000).toFixed(1) + 'M', 4, y + 4);
    }
    if (values.length === 0) return;
    function px(i) { return values.length === 1 ? padL + plotW / 2 : padL + plotW * i / (values.length - 1); }
    function py(v) { return padT + plotH * (1 - (v - minV) / (maxV - minV || 1)); }
    ctx.beginPath(); ctx.moveTo(px(0), py(values[0]));
    for (var i = 1; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
    ctx.strokeStyle = '#00d4aa'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(px(values.length - 1), padT + plotH); ctx.lineTo(px(0), padT + plotH); ctx.closePath();
    ctx.fillStyle = 'rgba(0,212,170,0.1)'; ctx.fill();
    ctx.fillStyle = '#00d4aa';
    for (var k = 0; k < values.length; k++) { ctx.beginPath(); ctx.arc(px(k), py(values[k]), 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#8b949e'; ctx.textAlign = 'center';
    for (var m = 0; m < labels.length; m++) ctx.fillText(labels[m], px(m), h - 6);
    ctx.textAlign = 'start';
  }
  function render() {
    var s = scalars();
    var usValue = 0, usCost = 0;
    STOCKS.forEach(function (st) { usValue += st.shares * st.price * s.fx; usCost += st.shares * st.cost * s.fx; });
    var fundTotal = 0;
    FUNDS.forEach(function (f) { fundTotal += f.units / 10000 * f.nav; });
    var total = usValue + fundTotal + s.ideco + s.cash;
    $('total-assets').textContent = fmtYen(total);
    var pct25 = Math.min(100, total / GOAL_25 * 100);
    $('progress-bar-1').style.width = pct25 + '%';
    $('progress-text').textContent = pct25.toFixed(1) + '%';
    $('progress-100m').textContent = (total / GOAL_30 * 100).toFixed(2);
    var usPL = usValue - usCost;
    $('us-cost').textContent = fmtYen(usCost);
    $('us-value').textContent = fmtYen(usValue);
    var plEl = $('us-pl');
    var plSign = usPL >= 0 ? '+' : '-';
    plEl.textContent = plSign + fmtYen(Math.abs(usPL));
    plEl.style.color = usPL >= 0 ? 'var(--success)' : 'var(--danger)';
    var pctEl = $('us-pl-pct');
    if (pctEl) {
      if (usCost > 0) {
        var usPLPct = usPL / usCost * 100;
        pctEl.textContent = '(' + plSign + Math.abs(usPLPct).toFixed(1) + '%)';
        pctEl.style.color = usPL >= 0 ? 'var(--success)' : 'var(--danger)';
      } else {
        pctEl.textContent = '';
      }
    }
    var cats = [
      {label: '米国株', value: usValue}, {label: '投資信託', value: fundTotal},
      {label: 'iDeCo', value: s.ideco}, {label: '現金', value: s.cash}
    ].sort(function (a, b) { return b.value - a.value; });
    var cc = $('category-cards'); cc.innerHTML = '';
    cats.forEach(function (c) {
      var div = document.createElement('div'); div.className = 'card';
      div.innerHTML = '<p class="card-label">' + c.label + '</p><p class="card-value">' + fmtYen(c.value) + '</p>';
      cc.appendChild(div);
    });
    var sorted = STOCKS.map(function (st) {
      var valueJPY = st.shares * st.price * s.fx;
      var costJPY = st.shares * st.cost * s.fx;
      var pl = valueJPY - costJPY;
      var plPct = costJPY > 0 ? (pl / costJPY * 100) : null;
      return {ticker: st.ticker, shares: st.shares, cost: st.cost, price: st.price, valueJPY: valueJPY, pl: pl, plPct: plPct};
    }).sort(function (a, b) { return b.valueJPY - a.valueJPY; });
    var tb = $('us-stock-body'); tb.innerHTML = '';
    sorted.forEach(function (st) {
      var tr = document.createElement('tr');
      var plColor = st.pl >= 0 ? 'var(--success)' : 'var(--danger)';
      var sign = st.pl >= 0 ? '+' : '-';
      var pctText = st.plPct === null ? '' : '(' + sign + Math.abs(st.plPct).toFixed(1) + '%)';
      var plAmountText = sign + fmtYen(Math.abs(st.pl));
      tr.innerHTML =
        '<td style="font-weight:700;">' + st.ticker + '</td><td>' + st.shares + '</td><td>' + st.cost.toFixed(2) + '</td>' +
        '<td>' + st.price.toFixed(2) + '</td><td>' + fmtYen(st.valueJPY) + '</td>' +
        '<td style="color:' + plColor + '; white-space:nowrap;">' +
          '<div>' + plAmountText + '</div>' +
          (pctText ? '<div style="font-size:11px; opacity:0.85;">' + pctText + '</div>' : '') +
        '</td>';
      tb.appendChild(tr);
    });
    var fb = $('fund-body'); fb.innerHTML = '';
    FUNDS.forEach(function (f) {
      var v = f.units / 10000 * f.nav;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td style="font-weight:500;" title="' + f.name + '">' + f.name + '</td><td>' + f.units.toFixed(1) + '</td><td>' + f.nav.toLocaleString('ja-JP') + '</td><td>' + fmtYen(v) + '</td>';
      fb.appendChild(tr);
    });
    var sum = cats.reduce(function (a, c) { return a + c.value; }, 0) || 1;
    var lg = $('alloc-legend'); lg.innerHTML = '';
    cats.forEach(function (c) {
      var pct = (c.value / sum * 100).toFixed(1);
      var span = document.createElement('span'); span.className = 'legend-item';
      span.innerHTML = '<span class="swatch" style="background:' + CAT_COLORS[c.label] + ';"></span>' + c.label + ' ' + pct + '%';
      lg.appendChild(span);
    });
    try {
      drawDoughnut($('allocChart'), cats.map(function (c) { return {value: c.value, color: CAT_COLORS[c.label]}; }));
      var agg = aggregateHistory(currentHistory, trendPeriod);
      var hl = agg.map(function (a) { return a.label; });
      var hv = agg.map(function (a) { return a.total; });
      hl.push('今'); hv.push(total);
      drawLine($('trendChart'), hl, hv);
    } catch (e) {}
    checkContributionDue();
    return total;
  }
  function fetchFx() {
    var fxStatus = $('fx-status');
    var avKey = $('av-api-key').value.trim();
    var finnhubKey = $('api-key').value.trim();
    var sources = [];

    // 1) Alpha Vantage: リアルタイム為替(専用APIキーがある場合)
    if (avKey) {
      sources.push({
        url: 'https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=JPY&apikey=' + encodeURIComponent(avKey),
        parse: function (d) {
          var r = d && d['Realtime Currency Exchange Rate'];
          var rate = r && parseFloat(r['5. Exchange Rate']);
          if (!rate) return null;
          return { rate: rate, label: '取得: ' + new Date().toLocaleString('ja-JP') };
        }
      });
    }

    // 2) Finnhub forex/rates(Finnhub APIキーがある場合)
    if (finnhubKey) {
      sources.push({
        url: 'https://finnhub.io/api/v1/forex/rates?base=USD&token=' + encodeURIComponent(finnhubKey),
        parse: function (d) {
          var q = d && d.quote;
          var rate = q && (q.JPY || q.jpy);
          if (!rate) return null;
          return { rate: rate, label: '取得: ' + new Date().toLocaleString('ja-JP') };
        }
      });
    }

    // 3) Frankfurter: 日次フォールバック
    ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY',
     'https://api.frankfurter.app/v1/latest?base=USD&symbols=JPY',
     'https://api.frankfurter.app/latest?from=USD&to=JPY'
    ].forEach(function (u) {
      sources.push({
        url: u,
        parse: function (d) {
          var rate = d.rates && d.rates.JPY;
          if (!rate) return null;
          return { rate: rate, label: '取得: ' + new Date().toLocaleString('ja-JP') + ' (日次レート)' };
        }
      });
    });

    function tryUrl(i) {
      if (i >= sources.length) {
        if (fxStatus) fxStatus.textContent = '為替の自動取得に失敗しました。手動で入力してください。';
        return Promise.resolve(false);
      }
      return fetch(sources[i].url)
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) {
          var result = sources[i].parse(d);
          if (!result) throw new Error('no rate in response');
          $('fx-rate').value = result.rate.toFixed(2);
          if (fxStatus) fxStatus.textContent = result.label;
          return true;
        })
        .catch(function () { return tryUrl(i + 1); });
    }
    if (fxStatus) fxStatus.textContent = '取得中...';
    return tryUrl(0);
  }
  function fetchStock(ticker, key) {
    return fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(ticker) + '&token=' + encodeURIComponent(key))
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { return (typeof d.c === 'number' && d.c > 0) ? d.c : null; });
  }
  function refreshAll(onComplete) {
    var btn = $('refresh-btn'), updated = $('last-updated');
    btn.disabled = true; updated.textContent = '取得中...';
    fetchFx().then(function () {
      var key = $('api-key').value.trim();
      if (!key) {
        updated.textContent = '為替のみ更新。株価取得にはFinnhub APIキーが必要です。';
        btn.disabled = false; render(); saveData();
        if (onComplete) onComplete();
        return;
      }
      var ok = 0, fail = 0, idx = 0;
      function next() {
        if (idx >= STOCKS.length) {
          var now = new Date();
          updated.textContent = '更新: ' + now.toLocaleString('ja-JP') + '(株価 ' + ok + '件取得' + (fail > 0 ? ' / ' + fail + '件失敗' : '') + ')';
          btn.disabled = false; buildStockInputs(); attachInputListeners(); render(); saveData();
          if (onComplete) onComplete();
          return;
        }
        var st = STOCKS[idx];
        fetchStock(st.ticker, key).then(function (price) {
          if (price !== null) { st.price = price; ok++; } else { fail++; }
        }).catch(function () { fail++; }).then(function () { idx++; setTimeout(next, 250); });
      }
      next();
    });
  }
  function applyContribution() {
    syncFromInputs();
    var s = scalars();
    FUNDS.forEach(function (f) { if (f.nav > 0 && f.monthly > 0) f.units += f.monthly / f.nav * 10000; });
    if (s.idecoMonthly > 0) { var el = $('ideco-value'); el.value = (parseFloat(el.value) || 0) + s.idecoMonthly; }
    lastContribMonth = monthKey(new Date());
    buildFundInputs(); attachInputListeners(); render();
    $('save-msg').textContent = '積立を反映しました。下の「保存」ボタンで確定してください。';
  }
  function autoSnapshot(total) {
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    var last = currentHistory[currentHistory.length - 1];
    if (!last || last.date !== dateStr) {
      currentHistory.push({date: dateStr, total: total});
      saveData();
    }
  }

  function boot() {
    buildStockInputs(); buildFundInputs();
    currentHistory = loadData();
    buildStockInputs(); buildFundInputs(); attachInputListeners();
    try { render(); } catch (e) {}

    // sim-area: クリック・タッチ両対応
    var simArea = $('sim-area');
    if (simArea) {
      simArea.addEventListener('click', function () { window.openSim(); });
      simArea.addEventListener('touchend', function (e) {
        e.preventDefault();
        window.openSim();
      });
      simArea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') window.openSim();
      });
    }

    $('refresh-btn').addEventListener('click', function () {
      refreshAll(function () {
        var total = render();
        autoSnapshot(total);
      });
    });
    $('apply-contribution-btn').addEventListener('click', applyContribution);

    var periodBtns = document.querySelectorAll('.period-btn');
    function updatePeriodButtons() {
      for (var p = 0; p < periodBtns.length; p++) {
        if (periodBtns[p].getAttribute('data-period') === trendPeriod) periodBtns[p].className = 'period-btn active';
        else periodBtns[p].className = 'period-btn';
      }
    }
    for (var b = 0; b < periodBtns.length; b++) {
      periodBtns[b].addEventListener('click', function () {
        trendPeriod = this.getAttribute('data-period');
        updatePeriodButtons();
        render();
      });
    }
    updatePeriodButtons();

    // 手動スナップショット保存ボタン
    $('save-btn').addEventListener('click', function () {
      syncFromInputs();
      var total = render(), now = new Date();
      var dateStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      var last = currentHistory[currentHistory.length - 1];
      if (last && last.date === dateStr) { last.total = total; }
      else { currentHistory.push({date: dateStr, total: total}); }
      saveData();
      $('save-msg').textContent = '記録しました(' + now.toLocaleString('ja-JP') + ')';
      render();
    });

    // メニューのAPIキー保存ボタン
    $('menu-save-btn').addEventListener('click', function () {
      saveData();
      $('menu-save-msg').textContent = '保存しました';
      setTimeout(function () { $('menu-save-msg').textContent = ''; }, 2000);
    });

    // 株価・為替を取得し終わったら自動スナップショット
    refreshAll(function () {
      var total = render();
      autoSnapshot(total);
    });
  }

  // ハンバーガーメニューの開閉(グローバル関数)
  window.openMenu = function () {
    var overlay = $('menu-overlay');
    $('menu-drawer').style.display = 'block';
    overlay.style.display = 'block';
    overlay.onclick = window.closeMenu;
    overlay.ontouchend = function(e) { e.preventDefault(); window.closeMenu(); };
  };
  window.closeMenu = function () {
    $('menu-drawer').style.display = 'none';
    $('menu-overlay').style.display = 'none';
  };

  // シミュレーターの開閉・計算
  var simCurrentTotal = 0;

  window.openSim = function () {
    // 保存済みのスライダー値を復元
    try {
      var saved = localStorage.getItem('sim-params');
      if (saved) {
        var p = JSON.parse(saved);
        if (p.stock) $('sim-stock').value = p.stock;
        if (p.fund) $('sim-fund').value = p.fund;
        if (p.dt) $('sim-dt').value = p.dt;
        if (p.tsumi) $('sim-tsumi').value = p.tsumi;
      }
    } catch(e) {}
    var overlay = $('sim-overlay');
    overlay.style.display = 'block';
    $('sim-modal').style.display = 'block';
    overlay.onclick = window.closeSim;
    overlay.ontouchend = function(e) { e.preventDefault(); window.closeSim(); };
    calcSim();
  };
  window.closeSim = function () {
    $('sim-overlay').style.display = 'none';
    $('sim-modal').style.display = 'none';
  };

  function drawSimLine(canvas, labels, datasets) {
    if (!canvas || !canvas.getContext) return;
    // 実際の表示幅に合わせてcanvasサイズを設定(右余白問題を解消)
    var displayW = canvas.parentElement ? canvas.parentElement.clientWidth : 448;
    if (displayW > 0) { canvas.width = displayW; canvas.height = 200; }
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var padL = 52, padR = 8, padT = 8, padB = 24;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var allVals = [];
    datasets.forEach(function (ds) { ds.data.forEach(function (v) { allVals.push(v); }); });
    var maxV = Math.max.apply(null, allVals.concat([1]));
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 0.5;
    ctx.fillStyle = '#8b949e'; ctx.font = '10px sans-serif';
    for (var g = 0; g <= 4; g++) {
      var y = padT + plotH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      var val = maxV * (1 - g / 4);
      ctx.fillText('¥' + (val / 10000).toFixed(0) + '万', 2, y + 4);
    }
    var n = labels.length;
    function px(i) { return n <= 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1); }
    function py(v) { return padT + plotH * (1 - v / (maxV || 1)); }
    datasets.forEach(function (ds) {
      ctx.beginPath(); ctx.moveTo(px(0), py(ds.data[0]));
      for (var i = 1; i < ds.data.length; i++) ctx.lineTo(px(i), py(ds.data[i]));
      ctx.strokeStyle = ds.color; ctx.lineWidth = ds.width || 1.5; ctx.stroke();
      ctx.fillStyle = ds.color;
      for (var k = 0; k < ds.data.length; k++) {
        ctx.beginPath(); ctx.arc(px(k), py(ds.data[k]), ds.width === 2 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.fillStyle = '#8b949e'; ctx.textAlign = 'center';
    for (var m = 0; m < labels.length; m++) ctx.fillText(labels[m], px(m), h - 6);
    ctx.textAlign = 'start';
  }

  function calcSim() {
    var GOAL = 10000000;
    var stockRate = parseInt($('sim-stock').value) / 100;
    var fundRate = parseInt($('sim-fund').value) / 100;
    var dtMonthly = parseInt($('sim-dt').value);
    var tsumiMonthly = parseInt($('sim-tsumi').value);
    $('sim-stock-label').textContent = (stockRate * 100).toFixed(0) + '%';
    $('sim-fund-label').textContent = (fundRate * 100).toFixed(0) + '%';
    $('sim-dt-label').textContent = fmtYen(dtMonthly);
    $('sim-tsumi-label').textContent = fmtYen(tsumiMonthly);

    // スライダーの値を保存
    try {
      localStorage.setItem('sim-params', JSON.stringify({
        stock: $('sim-stock').value,
        fund: $('sim-fund').value,
        dt: $('sim-dt').value,
        tsumi: $('sim-tsumi').value
      }));
    } catch(e) {}

    // 現在の資産を取得(scalars()から)
    var s = scalars();
    var usValue = 0, fundTotal = 0;
    STOCKS.forEach(function (st) { usValue += st.shares * st.price * s.fx; });
    FUNDS.forEach(function (f) { fundTotal += f.units / 10000 * f.nav; });
    var ideco = s.ideco, cash = s.cash;

    var cur = usValue + fundTotal + ideco + cash;
    simCurrentTotal = cur;
    $('sim-current').textContent = fmtYen(cur);

    var labels = ['現在', '1年後', '2年後', '3年後', '4年後', '5年後'];
    var stockArr = [usValue];
    var fundArr = [fundTotal + ideco];
    var totalArr = [cur];

    var stocks = usValue, funds = fundTotal, ide = ideco;
    for (var y = 1; y <= 5; y++) {
      stocks = stocks * (1 + stockRate) + dtMonthly * 12;
      funds = funds * (1 + fundRate) + tsumiMonthly * 12;
      ide = ide * (1 + fundRate);
      stockArr.push(Math.round(stocks));
      fundArr.push(Math.round(funds + ide));
      totalArr.push(Math.round(stocks + funds + ide + cash));
    }

    var future = totalArr[5];
    $('sim-future').textContent = fmtYen(future);
    var rate = future / GOAL * 100;
    var rateEl = $('sim-goal-rate');
    rateEl.textContent = rate.toFixed(1) + '%';
    rateEl.style.color = rate >= 100 ? 'var(--success)' : 'var(--amber)';
    $('sim-goal-gap').textContent = future >= GOAL ? '達成！' : fmtYen(GOAL - future);

    try {
      drawSimLine($('sim-chart'), labels, [
        {data: stockArr, color: '#58a6ff', width: 1.5},
        {data: fundArr, color: '#00d4aa', width: 1.5},
        {data: totalArr, color: '#a78bfa', width: 2}
      ]);
    } catch (e) {}

    var tableHTML = '';
    for (var i = 1; i <= 5; i++) {
      var t = totalArr[i];
      var g = (t / GOAL * 100).toFixed(1);
      var c = t >= GOAL ? 'var(--success)' : 'var(--text-primary)';
      tableHTML += '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:0.5px solid var(--border);">' +
        '<span style="color:var(--text-secondary);">' + i + '年後</span>' +
        '<span style="font-weight:500; color:' + c + ';">' + fmtYen(t) + ' <span style="font-size:11px; color:var(--text-tertiary);">(' + g + '%)</span></span>' +
        '</div>';
    }
    $('sim-year-table').innerHTML = tableHTML;
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  // シミュレーターのスライダーにイベント追加(DOM準備後)
  window.addEventListener('load', function () {
    ['sim-stock','sim-fund','sim-dt','sim-tsumi'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', calcSim);
    });
  });
})();
