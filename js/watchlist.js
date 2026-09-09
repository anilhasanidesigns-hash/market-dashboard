// ==============================================================================
// watchlist.js — persisted watchlist (IndexedDB) + search + live-updating table
// ==============================================================================

const Watchlist = (() => {
  let root = null;
  let items = []; // [{symbol, name, addedAt}]
  let unsubscribe = null;
  let searchTimer = null;
  let detailSymbol = null;
  let detailChart = null;

  async function load() {
    items = await DB.getWatchlist();
    items.sort((a, b) => a.addedAt - b.addedAt);
  }

  async function add(symbol) {
    const meta = MarketData.getMeta(symbol);
    if (!meta) return;
    await DB.addToWatchlist(symbol, { name: meta.name, shortName: meta.shortName, category: meta.category });
    MarketData.addActiveSymbol(symbol);
    await load();
    render();
    MarketData.forceRefresh(); // fetch the newly added symbol immediately, don't wait for next tick
  }

  async function remove(symbol) {
    await DB.removeFromWatchlist(symbol);
    if (detailSymbol === symbol) closeDetail();
    await load();
    render();
  }

  function isWatched(symbol) {
    return items.some((i) => i.symbol === symbol);
  }

  function statusBadge(q) {
    if (q.status === 'LIVE') return `<span class="badge badge-live">LIVE</span>`;
    if (q.status === 'LAST_KNOWN') {
      const t = q.asOf ? new Date(q.asOf) : null;
      return `<span class="badge badge-stale" title="Last known data">LAST KNOWN${
        t ? ' · ' + t.toLocaleTimeString('en-IN') : ''
      }</span>`;
    }
    return `<span class="badge badge-off">DATA UNAVAILABLE</span>`;
  }

  function priceCell(q, currency) {
    if (q.price === null || q.price === undefined) return `<span class="dim">—</span>`;
    return formatPrice(q.price, currency);
  }

  function changeCell(q) {
    if (q.change === null || q.change === undefined) return `<span class="dim">—</span>`;
    const cls = q.change > 0 ? 'positive' : q.change < 0 ? 'negative' : 'neutral';
    const sign = q.change > 0 ? '+' : '';
    const pct = q.changePercent !== null ? `${sign}${q.changePercent.toFixed(2)}%` : '';
    return `<span class="${cls}">${sign}${q.change.toFixed(2)} <small>(${pct})</small></span>`;
  }

  function renderTable() {
    if (!items.length) {
      return `
        <div class="empty-state">
          <p>Your watchlist is empty.</p>
          <p class="dim">Search for a stock above and add it to start tracking it here.</p>
        </div>`;
    }

    const rows = items
      .map((item) => {
        const q = MarketData.get(item.symbol);
        const meta = MarketData.getMeta(item.symbol);
        const currency = meta ? meta.currency : 'INR';
        return `
        <tr data-symbol="${item.symbol}" class="watch-row">
          <td class="cell-name">
            <div class="ticker-name">${item.shortName || item.name}</div>
            <div class="ticker-symbol dim">${item.symbol}</div>
          </td>
          <td class="cell-price num">${priceCell(q, currency)}</td>
          <td class="cell-change num">${changeCell(q)}</td>
          <td class="cell-status">${statusBadge(q)}</td>
          <td class="cell-actions">
            <button class="icon-btn" data-action="view" title="View details">▤</button>
            <button class="icon-btn" data-action="remove" title="Remove">✕</button>
          </td>
        </tr>`;
      })
      .join('');

    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th class="num">Price</th>
            <th class="num">Change</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderDetail() {
    if (!detailSymbol) return '';
    const meta = MarketData.getMeta(detailSymbol);
    const q = MarketData.get(detailSymbol);
    if (!meta) return '';
    return `
      <div class="detail-panel" id="watch-detail">
        <div class="detail-header">
          <div>
            <h3>${meta.name}</h3>
            <div class="dim">${meta.symbol} · ${meta.exchangeName || (meta.category === 'stock' ? 'NSE' : '')}</div>
          </div>
          <button class="icon-btn" id="close-detail">✕</button>
        </div>
        <div class="detail-price-row">
          <div class="detail-price">${priceCell(q, meta.currency)}</div>
          <div class="detail-change">${changeCell(q)}</div>
          ${statusBadge(q)}
        </div>
        <div class="period-tabs" id="detail-period-tabs">
          ${['1D', '1W', '1M', '3M', '1Y'].map((p) => `<button class="period-tab${p === '1D' ? ' active' : ''}" data-period="${p}">${p}</button>`).join('')}
        </div>
        <div class="chart-container"><canvas id="detail-chart"></canvas></div>
        <div class="detail-stats">
          <div><span class="dim">Day High</span><strong>${q.dayHigh !== undefined && q.dayHigh !== null ? formatPrice(q.dayHigh, meta.currency) : '—'}</strong></div>
          <div><span class="dim">Day Low</span><strong>${q.dayLow !== undefined && q.dayLow !== null ? formatPrice(q.dayLow, meta.currency) : '—'}</strong></div>
          <div><span class="dim">Prev. Close</span><strong>${q.previousClose !== undefined && q.previousClose !== null ? formatPrice(q.previousClose, meta.currency) : '—'}</strong></div>
          <div><span class="dim">Last Updated</span><strong>${q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleTimeString('en-IN') : '—'}</strong></div>
        </div>
      </div>`;
  }

  async function loadDetailChart(period = '1D') {
    const el = document.getElementById('detail-chart');
    if (!el || !detailSymbol) return;
    if (!detailChart) {
      detailChart = new SparkChart(el);
    }
    try {
      const data = await MarketData.getChart(detailSymbol, period);
      detailChart.setData(data.series || []);
    } catch (err) {
      detailChart.setData([]);
    }
  }

  function openDetail(symbol) {
    detailSymbol = symbol;
    MarketData.addActiveSymbol(symbol);
    DB.pushRecent(symbol, MarketData.getMeta(symbol)?.name || symbol);
    render();
    loadDetailChart('1D');
    MarketData.forceRefresh();
  }

  function closeDetail() {
    detailSymbol = null;
    if (detailChart) {
      detailChart.destroy();
      detailChart = null;
    }
    render();
  }

  function renderSearchResults(results, remoteResults, remoteAvailable) {
    const box = document.getElementById('watch-search-results');
    if (!box) return;
    if (!results.length && !(remoteResults && remoteResults.length)) {
      box.innerHTML = `<div class="search-empty dim">No matching instruments in this dashboard's tracked universe.</div>`;
      box.classList.add('open');
      return;
    }
    const known = results
      .map(
        (r) => `
        <div class="search-row" data-symbol="${r.symbol}">
          <div>
            <div class="ticker-name">${r.name}</div>
            <div class="ticker-symbol dim">${r.symbol}</div>
          </div>
          <button class="btn-small" data-add="${r.symbol}">${isWatched(r.symbol) ? 'Added' : 'Add'}</button>
        </div>`
      )
      .join('');

    let remoteHtml = '';
    if (remoteResults && remoteResults.length) {
      remoteHtml = `
        <div class="search-section-label dim">Found on Yahoo Finance, not yet trackable in this dashboard</div>
        ${remoteResults
          .slice(0, 5)
          .map(
            (r) => `
          <div class="search-row disabled">
            <div>
              <div class="ticker-name">${r.name}</div>
              <div class="ticker-symbol dim">${r.symbol} ${r.exchange ? '· ' + r.exchange : ''}</div>
            </div>
            <span class="dim">Not tracked</span>
          </div>`
          )
          .join('')}`;
    } else if (!remoteAvailable) {
      remoteHtml = `<div class="search-section-label dim">Live symbol search is temporarily unavailable — showing local matches only.</div>`;
    }

    box.innerHTML = known + remoteHtml;
    box.classList.add('open');
  }

  function formatPrice(value, currency) {
    if (value === null || value === undefined) return '—';
    const symbol = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : '';
    return `${symbol}${value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }

  function render() {
    if (!root) return;
    root.innerHTML = `
      <div class="view-header">
        <h2>Watchlist</h2>
        <div class="search-wrap">
          <input type="text" id="watch-search-input" placeholder="Search by company or symbol (e.g. TCS, Reliance)" autocomplete="off" />
          <div id="watch-search-results" class="search-results"></div>
        </div>
      </div>
      ${detailSymbol ? renderDetail() : renderTable()}
    `;
    bindEvents();
  }

  function bindEvents() {
    const input = document.getElementById('watch-search-input');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) {
          document.getElementById('watch-search-results').classList.remove('open');
          return;
        }
        searchTimer = setTimeout(async () => {
          const { results, remoteResults, remoteSearchAvailable } = await API.search(q);
          renderSearchResults(results, remoteResults, remoteSearchAvailable);
        }, 250);
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrap')) {
          document.getElementById('watch-search-results')?.classList.remove('open');
        }
      });
    }

    // Delegated listener: #watch-search-results itself is only created once
    // per render(), but its innerHTML (and therefore its "Add" buttons) is
    // replaced on every keystroke by renderSearchResults(). Binding directly
    // to [data-add] buttons here would miss every button added afterwards —
    // that was the bug where "Add" appeared to do nothing.
    document.getElementById('watch-search-results')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn) return;
      e.stopPropagation();
      const symbol = btn.getAttribute('data-add');
      await add(symbol);
      btn.textContent = 'Added';
    });

    root.querySelectorAll('.watch-row').forEach((rowEl) => {
      const symbol = rowEl.getAttribute('data-symbol');
      rowEl.querySelector('[data-action="view"]')?.addEventListener('click', () => openDetail(symbol));
      rowEl.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        remove(symbol);
      });
    });

    document.getElementById('close-detail')?.addEventListener('click', closeDetail);

    root.querySelectorAll('.period-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        root.querySelectorAll('.period-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        loadDetailChart(tab.getAttribute('data-period'));
      });
    });
  }

  function refreshPrices() {
    // Partial DOM update on every poll tick — avoids rebuilding the table
    // (which would drop search focus) and avoids recreating the detail
    // chart's canvas (which would destroy the SparkChart instance).
    if (!root) return;

    root.querySelectorAll('tr.watch-row').forEach((rowEl) => {
      const symbol = rowEl.getAttribute('data-symbol');
      const meta = MarketData.getMeta(symbol);
      const q = MarketData.get(symbol);
      rowEl.querySelector('.cell-price').innerHTML = priceCell(q, meta ? meta.currency : 'INR');
      rowEl.querySelector('.cell-change').innerHTML = changeCell(q);
      rowEl.querySelector('.cell-status').innerHTML = statusBadge(q);
    });

    if (detailSymbol) {
      const meta = MarketData.getMeta(detailSymbol);
      const q = MarketData.get(detailSymbol);
      const panel = document.getElementById('watch-detail');
      if (panel && meta) {
        panel.querySelector('.detail-price').innerHTML = priceCell(q, meta.currency);
        panel.querySelector('.detail-change').innerHTML = changeCell(q);
        const badge = panel.querySelector('.detail-price-row').lastElementChild;
        if (badge) badge.outerHTML = statusBadge(q);
        const stats = panel.querySelectorAll('.detail-stats > div > strong');
        if (stats.length === 4) {
          stats[0].textContent = q.dayHigh != null ? formatPrice(q.dayHigh, meta.currency) : '—';
          stats[1].textContent = q.dayLow != null ? formatPrice(q.dayLow, meta.currency) : '—';
          stats[2].textContent = q.previousClose != null ? formatPrice(q.previousClose, meta.currency) : '—';
          stats[3].textContent = q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleTimeString('en-IN') : '—';
        }
      }
    }
  }

  async function init(rootEl) {
    root = rootEl;
    await load();
    MarketData.setActiveSymbols([...MarketData.getCoreSymbols(), ...items.map((i) => i.symbol)]);
    render();
    unsubscribe = MarketData.on('update', () => refreshPrices());
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (detailChart) {
      detailChart.destroy();
      detailChart = null;
    }
    root = null;
  }

  return { init, destroy, add, remove, formatPrice };
})();

window.Watchlist = Watchlist;
