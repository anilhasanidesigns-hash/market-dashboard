// ==============================================================================
// overview.js — the landing dashboard: NIFTY 50 + SENSEX hero cards, and
// Gold / Silver / USD-INR cards. This is the "open the app and immediately
// see the market" view.
// ==============================================================================

const Overview = (() => {
  let root = null;
  let unsubscribe = null;
  const charts = {}; // symbol -> SparkChart
  const expanded = {}; // symbol -> bool (for compact cards)
  const activePeriod = {}; // symbol -> '1D' etc

  function statusBadge(q) {
    if (q.status === 'LIVE') return `<span class="badge badge-live">LIVE</span>`;
    if (q.status === 'LAST_KNOWN') {
      const t = q.asOf ? new Date(q.asOf).toLocaleTimeString('en-IN') : '';
      return `<span class="badge badge-stale">LAST KNOWN DATA${t ? ' · ' + t : ''}</span>`;
    }
    return `<span class="badge badge-off">DATA UNAVAILABLE</span>`;
  }

  function fmt(value, currency) {
    if (value === null || value === undefined) return '—';
    const symbol = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : '';
    return `${symbol}${value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }

  function changeHtml(q) {
    if (q.change === null || q.change === undefined) return `<span class="dim">—</span>`;
    const cls = q.change > 0 ? 'positive' : q.change < 0 ? 'negative' : 'neutral';
    const sign = q.change > 0 ? '+' : '';
    return `<span class="${cls}">${sign}${q.change.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${sign}${(q.changePercent ?? 0).toFixed(2)}%)</span>`;
  }

  function heroCard(symbol) {
    const meta = MarketData.getMeta(symbol);
    const q = MarketData.get(symbol);
    if (!meta) return '';
    const period = activePeriod[symbol] || '1D';
    return `
      <section class="hero-card" data-symbol="${symbol}">
        <div class="hero-top">
          <div>
            <h2>${meta.name}</h2>
            <div class="dim">${meta.symbol}</div>
          </div>
          <div class="hero-status">
            ${statusBadge(q)}
            <span id="mstatus-${symbol}" class="badge badge-neutral"></span>
          </div>
        </div>
        <div class="hero-price-row">
          <div class="hero-price">${fmt(q.price, meta.currency)}</div>
          <div class="hero-change">${changeHtml(q)}</div>
        </div>
        <div class="period-tabs" data-symbol="${symbol}">
          ${['1D', '1W', '1M', '3M', '1Y'].map((p) => `<button class="period-tab${p === period ? ' active' : ''}" data-period="${p}">${p}</button>`).join('')}
        </div>
        <div class="chart-container hero-chart"><canvas id="chart-${cssId(symbol)}"></canvas></div>
        <div class="hero-stats">
          <div><span class="dim">Day High</span><strong>${fmt(q.dayHigh, meta.currency)}</strong></div>
          <div><span class="dim">Day Low</span><strong>${fmt(q.dayLow, meta.currency)}</strong></div>
          <div><span class="dim">Prev. Close</span><strong>${fmt(q.previousClose, meta.currency)}</strong></div>
          <div><span class="dim">Last Updated</span><strong id="updated-${cssId(symbol)}">${q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleTimeString('en-IN') : '—'}</strong></div>
        </div>
      </section>`;
  }

  function compactCard(symbol) {
    const meta = MarketData.getMeta(symbol);
    const q = MarketData.get(symbol);
    if (!meta) return '';
    const isOpen = !!expanded[symbol];
    const period = activePeriod[symbol] || '1D';
    return `
      <section class="compact-card ${isOpen ? 'open' : ''}" data-symbol="${symbol}">
        <div class="compact-top">
          <div>
            <h3>${meta.shortName}</h3>
            <div class="dim">${meta.currency === 'USD' ? 'USD / troy oz' : meta.symbol}</div>
          </div>
          ${statusBadge(q)}
        </div>
        <div class="compact-price-row">
          <div class="compact-price">${fmt(q.price, meta.currency)}</div>
          <div>${changeHtml(q)}</div>
        </div>
        <div class="chart-container compact-chart"><canvas id="chart-${cssId(symbol)}"></canvas></div>
        <button class="link-btn" data-toggle-expand="${symbol}">${isOpen ? 'Hide details' : 'View details'}</button>
        ${
          isOpen
            ? `
        <div class="period-tabs" data-symbol="${symbol}">
          ${['1D', '1W', '1M', '3M', '1Y'].map((p) => `<button class="period-tab${p === period ? ' active' : ''}" data-period="${p}">${p}</button>`).join('')}
        </div>
        <div class="compact-stats">
          <div><span class="dim">Day High</span><strong>${fmt(q.dayHigh, meta.currency)}</strong></div>
          <div><span class="dim">Day Low</span><strong>${fmt(q.dayLow, meta.currency)}</strong></div>
          <div><span class="dim">Prev. Close</span><strong>${fmt(q.previousClose, meta.currency)}</strong></div>
          <div><span class="dim">Last Updated</span><strong>${q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleTimeString('en-IN') : '—'}</strong></div>
        </div>`
            : ''
        }
      </section>`;
  }

  function cssId(symbol) {
    return symbol.replace(/[^a-zA-Z0-9]/g, '_');
  }

  function render() {
    if (!root) return;
    root.innerHTML = `
      <div class="view-header">
        <h2>Overview</h2>
      </div>
      <div class="hero-grid">
        ${heroCard('^NSEI')}
        ${heroCard('^BSESN')}
      </div>
      <div class="view-header secondary">
        <h3>Commodities &amp; Currency</h3>
      </div>
      <div class="compact-grid">
        ${compactCard('GC=F')}
        ${compactCard('SI=F')}
        ${compactCard('INR=X')}
      </div>
    `;
    bindEvents();
    mountCharts();
    updateMarketStatusBadges();
  }

  function bindEvents() {
    root.querySelectorAll('.period-tabs').forEach((tabsEl) => {
      const symbol = tabsEl.getAttribute('data-symbol');
      tabsEl.querySelectorAll('.period-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          tabsEl.querySelectorAll('.period-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const period = btn.getAttribute('data-period');
          activePeriod[symbol] = period;
          loadChart(symbol, period);
        });
      });
    });

    root.querySelectorAll('[data-toggle-expand]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const symbol = btn.getAttribute('data-toggle-expand');
        expanded[symbol] = !expanded[symbol];
        render();
      });
    });
  }

  function mountCharts() {
    ['^NSEI', '^BSESN', 'GC=F', 'SI=F', 'INR=X'].forEach((symbol) => {
      const canvas = document.getElementById(`chart-${cssId(symbol)}`);
      if (!canvas) return;
      if (charts[symbol]) charts[symbol].destroy();
      charts[symbol] = new SparkChart(canvas);
      loadChart(symbol, activePeriod[symbol] || '1D');
    });
  }

  async function loadChart(symbol, period) {
    if (!charts[symbol]) return;
    try {
      const data = await MarketData.getChart(symbol, period);
      charts[symbol].setData(data.series || []);
    } catch (err) {
      charts[symbol].setData([]);
    }
  }

  function updateMarketStatusBadges() {
    ['^NSEI', '^BSESN'].forEach((symbol) => {
      const q = MarketData.get(symbol);
      const el = document.getElementById(`mstatus-${symbol}`);
      if (!el) return;
      const status = MarketStatus.resolveStatus(q.marketState);
      el.textContent = status.estimated ? `${status.label} (est.)` : status.label;
      el.className = 'badge ' + (status.state === 'OPEN' ? 'badge-live' : status.state === 'PRE_OPEN' ? 'badge-stale' : 'badge-neutral');
    });
  }

  function refreshPrices() {
    // Partial updates only — never touch the chart canvases here, since
    // SparkChart instances are stateful and only refreshed via loadChart().
    ['^NSEI', '^BSESN', 'GC=F', 'SI=F', 'INR=X'].forEach((symbol) => {
      const card = root?.querySelector(`[data-symbol="${symbol}"]`);
      if (!card) return;
      const meta = MarketData.getMeta(symbol);
      const q = MarketData.get(symbol);

      const priceEl = card.querySelector('.hero-price, .compact-price');
      if (priceEl) priceEl.textContent = fmt(q.price, meta.currency);

      const changeEl = card.querySelector('.hero-change, .compact-price-row > div:last-child');
      if (changeEl) changeEl.innerHTML = changeHtml(q);

      const badge = card.querySelector('.badge-live, .badge-stale, .badge-off');
      if (badge && !badge.id.startsWith('mstatus')) badge.outerHTML = statusBadge(q);

      const updatedEl = document.getElementById(`updated-${cssId(symbol)}`);
      if (updatedEl) updatedEl.textContent = q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleTimeString('en-IN') : '—';
    });
    updateMarketStatusBadges();
  }

  async function init(rootEl) {
    root = rootEl;
    MarketData.setActiveSymbols(MarketData.getCoreSymbols());
    render();
    unsubscribe = MarketData.on('update', () => refreshPrices());
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    Object.values(charts).forEach((c) => c.destroy());
    Object.keys(charts).forEach((k) => delete charts[k]);
    root = null;
  }

  return { init, destroy };
})();

window.Overview = Overview;
