// ==============================================================================
// alerts.js — price alert rules, evaluated only against live MarketData
// ticks. Alerts never fire from cached/last-known data, and never from
// simulated prices — only from a quote whose status is 'LIVE'.
// ==============================================================================

const Alerts = (() => {
  let root = null;
  let alerts = [];
  let unsubscribe = null;
  let notifPermission = 'default';

  async function load() {
    alerts = await DB.getAlerts();
  }

  function instrumentOptions() {
    return MarketData.registry
      .map((s) => `<option value="${s.symbol}">${s.shortName} (${s.symbol})</option>`)
      .join('');
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      notifPermission = 'unsupported';
      return;
    }
    notifPermission = Notification.permission;
    if (notifPermission === 'default') {
      notifPermission = await Notification.requestPermission();
    }
  }

  function maybeNotify(alert, q) {
    if (notifPermission !== 'granted') return;
    const meta = MarketData.getMeta(alert.symbol);
    const n = new Notification('Price Alert Triggered', {
      body: `${meta ? meta.shortName : alert.symbol} ${alert.direction === 'above' ? 'rose above' : 'fell below'} ${alert.threshold}`,
      tag: `alert-${alert.id}`,
    });
    setTimeout(() => n.close(), 8000);
  }

  function evaluateAlerts() {
    let changed = false;
    for (const alert of alerts) {
      if (!alert.enabled || alert.triggeredAt) continue;
      const q = MarketData.get(alert.symbol);
      if (!q || q.status !== 'LIVE' || typeof q.price !== 'number') continue; // only ever act on LIVE data

      const hit =
        (alert.direction === 'above' && q.price > alert.threshold) ||
        (alert.direction === 'below' && q.price < alert.threshold);

      if (hit) {
        alert.triggeredAt = Date.now();
        alert.triggeredPrice = q.price;
        DB.updateAlert(alert);
        maybeNotify(alert, q);
        changed = true;
      }
    }
    if (changed) render();
  }

  function renderList() {
    if (!alerts.length) {
      return `<div class="empty-state">
        <p>No alerts configured.</p>
        <p class="dim">e.g. "TCS &gt; ₹4000" or "NIFTY 50 &lt; 24000"</p>
      </div>`;
    }
    return `
      <div class="alerts-list">
        ${alerts
          .map((a) => {
            const meta = MarketData.getMeta(a.symbol);
            const q = MarketData.get(a.symbol);
            const isRise = a.direction === 'above';
            const directionLabel = isRise ? 'PRICE RISE' : 'PRICE DROP';
            const directionText = isRise ? 'Rose above' : 'Fell below';
            const arrow = isRise ? '↑' : '↓';
            const tone = isRise ? 'up' : 'down';
            const livePrice = typeof q.price === 'number' ? q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
            const threshold = a.threshold.toLocaleString('en-IN', { maximumFractionDigits: 2 });
            const triggeredPrice = typeof a.triggeredPrice === 'number' ? a.triggeredPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : livePrice;
            const statusLabel = a.triggeredAt ? 'TRIGGERED' : a.enabled ? 'WATCHING' : 'PAUSED';
            return `
            <div class="alert-card ${a.triggeredAt ? 'triggered' : ''} ${tone}">
              <div class="alert-direction ${tone}" aria-label="${directionLabel}">
                <span class="alert-direction-arrow">${arrow}</span>
                <span>${directionLabel}</span>
              </div>
              <div class="alert-main">
                <div class="alert-card-head">
                  <div>
                    <strong class="alert-symbol-name">${meta ? meta.shortName : a.symbol}</strong>
                    <span class="ticker-symbol dim">${a.symbol}</span>
                  </div>
                  <span class="alert-status ${statusLabel.toLowerCase()}">${statusLabel}</span>
                </div>
                <div class="alert-price-line">
                  <span class="alert-price-label">Target</span>
                  <strong>${isRise ? 'Above' : 'Below'} ₹${threshold}</strong>
                  <span class="alert-live-price">Live ₹${livePrice}</span>
                </div>
                <div class="alert-progress"><span style="width:${a.triggeredAt ? '100' : '0'}%"></span></div>
                <div class="alert-card-foot">
                  <span>${a.triggeredAt ? `${directionText} ₹${triggeredPrice}` : `Waiting for price to ${isRise ? 'rise' : 'fall'} past target`}</span>
                  ${a.triggeredAt ? `<span>${new Date(a.triggeredAt).toLocaleString('en-IN')}</span>` : `<span>${q.status === 'LIVE' ? 'Live market data' : 'Waiting for live data'}</span>`}
                </div>
              </div>
              <div class="alert-actions">
                <label class="switch">
                  <input type="checkbox" data-toggle="${a.id}" ${a.enabled ? 'checked' : ''} />
                  <span class="slider"></span>
                </label>
                <button class="icon-btn" data-remove="${a.id}" aria-label="Remove alert">✕</button>
              </div>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function render() {
    if (!root) return;
    root.innerHTML = `
      <div class="view-header">
        <h2>Price Alerts</h2>
        <span class="dim">${notifPermission === 'granted' ? 'Browser notifications enabled' : notifPermission === 'unsupported' ? 'Browser notifications not supported' : 'Notifications not enabled — alerts still show here'}</span>
      </div>
      <form id="add-alert-form" class="inline-form">
        <select id="alert-symbol" required>
          <option value="" disabled selected>Select instrument…</option>
          ${instrumentOptions()}
        </select>
        <select id="alert-direction">
          <option value="above">rises above</option>
          <option value="below">falls below</option>
        </select>
        <input type="number" id="alert-threshold" placeholder="Price threshold" min="0" step="any" required />
        <button type="submit" class="btn-primary">Create Alert</button>
      </form>
      ${renderList()}
    `;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('add-alert-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const symbol = document.getElementById('alert-symbol').value;
      const direction = document.getElementById('alert-direction').value;
      const threshold = parseFloat(document.getElementById('alert-threshold').value);
      if (!symbol || !threshold) return;
      await DB.addAlert({ symbol, direction, threshold, enabled: true, createdAt: Date.now(), triggeredAt: null });
      MarketData.addActiveSymbol(symbol);
      await load();
      render();
      MarketData.forceRefresh();
    });

    root.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('change', async () => {
        const id = Number(el.getAttribute('data-toggle'));
        const alert = alerts.find((a) => a.id === id);
        if (!alert) return;
        alert.enabled = el.checked;
        await DB.updateAlert(alert);
      });
    });

    root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await DB.removeAlert(Number(btn.getAttribute('data-remove')));
        await load();
        render();
      });
    });
  }

  let backgroundStarted = false;

  // Alerts must keep evaluating even when the Alerts view isn't the one
  // on screen — otherwise a "TCS > 4000" alert would only ever fire while
  // the user happens to be looking at the Alerts tab. This runs once at
  // app boot, independent of the view's own init/destroy (which only
  // controls the DOM).
  async function startBackgroundWatch() {
    if (backgroundStarted) return;
    backgroundStarted = true;
    await load();
    alerts.forEach((a) => MarketData.addActiveSymbol(a.symbol));
    await requestNotificationPermission();
    MarketData.on('update', () => evaluateAlerts());
  }

  async function init(rootEl) {
    root = rootEl;
    await startBackgroundWatch();
    await load(); // pick up anything changed while view was closed
    render();
    unsubscribe = MarketData.on('update', () => {
      if (root) render();
    });
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    root = null;
  }

  return { init, destroy, evaluateAlerts, startBackgroundWatch };
})();

window.Alerts = Alerts;
