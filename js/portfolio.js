// ==============================================================================
// portfolio.js — simple holdings tracker (NOT real trading). Quantities and
// buy prices are user-entered and stored in IndexedDB. Current value and
// P/L are computed live from MarketData — never from a stored/stale price.
// ==============================================================================

const Portfolio = (() => {
  let root = null;
  let holdings = []; // holdings across ALL portfolios; each carries a portfolioId
  let portfolios = []; // [{ id, name, createdAt }]
  let activePortfolioId = null;
  let unsubscribe = null;

  async function load() {
    holdings = await DB.getPortfolio();
    portfolios = await DB.getPortfolios();
  }

  // First run after this update: there's no portfolio row yet, but there
  // may already be holdings from before multi-portfolio support existed.
  // Create a default "Portfolio 1" and attach any such orphaned holdings to
  // it, so nothing the user already tracked disappears.
  async function ensurePortfolios() {
    if (!portfolios.length) {
      const id = await DB.addPortfolioMeta('Portfolio 1');
      portfolios = [{ id, name: 'Portfolio 1', createdAt: Date.now() }];
    }
    const defaultId = portfolios[0].id;
    const orphaned = holdings.filter((h) => h.portfolioId == null);
    for (const h of orphaned) {
      h.portfolioId = defaultId;
      await DB.updateHolding(h);
    }
  }

  async function resolveActivePortfolio() {
    const saved = await DB.getSetting('activePortfolioId', null);
    activePortfolioId = saved != null && portfolios.some((p) => p.id === saved) ? saved : portfolios[0].id;
  }

  function currentHoldings() {
    return holdings.filter((h) => h.portfolioId === activePortfolioId);
  }

  function stockOptions() {
    return MarketData.getAllStockSymbols()
      .map((sym) => {
        const meta = MarketData.getMeta(sym);
        return `<option value="${sym}">${meta.shortName} (${sym})</option>`;
      })
      .join('');
  }

  function computeRow(holding) {
    const q = MarketData.get(holding.symbol);
    const meta = MarketData.getMeta(holding.symbol);
    const invested = holding.quantity * holding.buyPrice;
    const hasPrice = q && typeof q.price === 'number';
    const currentValue = hasPrice ? q.price * holding.quantity : null;
    const pl = hasPrice ? currentValue - invested : null;
    const plPct = hasPrice && invested ? (pl / invested) * 100 : null;
    return { holding, meta, q, invested, currentValue, pl, plPct, hasPrice };
  }

  function renderSummary(rows) {
    const validRows = rows.filter((r) => r.hasPrice);
    const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
    const totalCurrent = validRows.reduce((s, r) => s + r.currentValue, 0) +
      rows.filter((r) => !r.hasPrice).reduce((s, r) => s + r.invested, 0); // fallback for unavailable
    const totalPl = validRows.reduce((s, r) => s + r.pl, 0);
    const totalPlPct = totalInvested ? (totalPl / totalInvested) * 100 : 0;
    const allPriced = rows.length > 0 && rows.every((r) => r.hasPrice);

    return `
      <div class="portfolio-summary">
        <div class="summary-card">
          <span class="dim">Invested</span>
          <strong>₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
        </div>
        <div class="summary-card">
          <span class="dim">Current Value</span>
          <strong>${rows.length ? '₹' + totalCurrent.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</strong>
          ${!allPriced && rows.length ? '<div class="badge badge-stale">Some prices unavailable</div>' : ''}
        </div>
        <div class="summary-card">
          <span class="dim">Profit / Loss</span>
          <strong class="${totalPl > 0 ? 'positive' : totalPl < 0 ? 'negative' : ''}">${
      rows.length ? (totalPl >= 0 ? '+' : '') + '₹' + totalPl.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
    }</strong>
        </div>
        <div class="summary-card">
          <span class="dim">Return</span>
          <strong class="${totalPlPct > 0 ? 'positive' : totalPlPct < 0 ? 'negative' : ''}">${
      rows.length ? (totalPlPct >= 0 ? '+' : '') + totalPlPct.toFixed(2) + '%' : '—'
    }</strong>
        </div>
      </div>`;
  }

  function renderTable(rows) {
    if (!rows.length) {
      return `<div class="empty-state">
        <p>No holdings yet.</p>
        <p class="dim">Add a holding above to track its live profit/loss.</p>
      </div>`;
    }
    const body = rows
      .map((r) => {
        const { holding, meta, pl, plPct, currentValue, hasPrice, q } = r;
        return `
        <tr>
          <td class="cell-name">
            <div class="ticker-name">${meta ? meta.shortName : holding.symbol}</div>
            <div class="ticker-symbol dim">${holding.symbol}</div>
          </td>
          <td class="num">${holding.quantity}</td>
          <td class="num">₹${holding.buyPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
          <td class="num">${hasPrice ? '₹' + q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '<span class="dim">DATA UNAVAILABLE</span>'}</td>
          <td class="num">${hasPrice ? '₹' + currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
          <td class="num ${hasPrice && pl >= 0 ? 'positive' : hasPrice ? 'negative' : ''}">${
          hasPrice ? (pl >= 0 ? '+' : '') + '₹' + pl.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)` : '—'
        }</td>
          <td><button class="icon-btn" data-remove="${holding.id}">✕</button></td>
        </tr>`;
      })
      .join('');
    return `
      <table class="data-table">
        <thead>
          <tr><th>Stock</th><th class="num">Qty</th><th class="num">Buy Price</th><th class="num">Current Price</th><th class="num">Current Value</th><th class="num">P/L</th><th></th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function renderPortfolioTabs() {
    return `
      <div class="portfolio-toolbar">
        <div class="portfolio-tabs">
          ${portfolios
            .map(
              (p) => `<button class="portfolio-tab${p.id === activePortfolioId ? ' active' : ''}" data-portfolio="${p.id}">${p.name}</button>`
            )
            .join('')}
          <button class="portfolio-tab portfolio-tab-add" id="new-portfolio-btn" title="New portfolio">+ New</button>
        </div>
        <div class="portfolio-toolbar-actions">
          <button class="icon-btn" id="rename-portfolio-btn" title="Rename this portfolio">✎</button>
          <button class="icon-btn" id="delete-portfolio-btn" title="Delete this portfolio" ${portfolios.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>
      </div>`;
  }

  function render() {
    if (!root) return;
    const rows = currentHoldings().map(computeRow);
    root.innerHTML = `
      <div class="view-header">
        <h2>Portfolio</h2>
        <span class="dim">Manual entry tracker — not connected to a broker. This is not real trading.</span>
      </div>
      ${renderPortfolioTabs()}
      <form id="add-holding-form" class="inline-form">
        <select id="holding-symbol" required>
          <option value="" disabled selected>Select stock…</option>
          ${stockOptions()}
        </select>
        <input type="number" id="holding-qty" placeholder="Quantity" min="0.0001" step="any" required />
        <input type="number" id="holding-price" placeholder="Buy price (₹)" min="0.01" step="any" required />
        <button type="submit" class="btn-primary">Add Holding</button>
      </form>
      <div id="portfolio-summary">${renderSummary(rows)}</div>
      <div id="portfolio-table">${renderTable(rows)}</div>
    `;
    bindEvents();
  }

  function refreshValues() {
    if (!root) return;
    const summaryEl = document.getElementById('portfolio-summary');
    const tableEl = document.getElementById('portfolio-table');
    if (!summaryEl || !tableEl) return; // structure not mounted yet
    const rows = currentHoldings().map(computeRow);
    summaryEl.innerHTML = renderSummary(rows);
    tableEl.innerHTML = renderTable(rows);
    // re-bind only the remove buttons since the table was replaced
    tableEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await DB.removeHolding(Number(btn.getAttribute('data-remove')));
        await load();
        render();
      });
    });
  }

  function bindEvents() {
    document.getElementById('add-holding-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const symbol = document.getElementById('holding-symbol').value;
      const quantity = parseFloat(document.getElementById('holding-qty').value);
      const buyPrice = parseFloat(document.getElementById('holding-price').value);
      if (!symbol || !quantity || !buyPrice) return;
      await DB.addHolding({ symbol, quantity, buyPrice, portfolioId: activePortfolioId, addedAt: Date.now() });
      MarketData.addActiveSymbol(symbol);
      await load();
      render();
      MarketData.forceRefresh();
    });

    root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await DB.removeHolding(Number(btn.getAttribute('data-remove')));
        await load();
        render();
      });
    });

    root.querySelectorAll('.portfolio-tab[data-portfolio]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        activePortfolioId = Number(btn.getAttribute('data-portfolio'));
        await DB.setSetting('activePortfolioId', activePortfolioId);
        render();
      });
    });

    document.getElementById('new-portfolio-btn')?.addEventListener('click', async () => {
      const name = prompt('Name for the new portfolio:');
      if (!name || !name.trim()) return;
      const id = await DB.addPortfolioMeta(name.trim());
      portfolios.push({ id, name: name.trim(), createdAt: Date.now() });
      activePortfolioId = id;
      await DB.setSetting('activePortfolioId', activePortfolioId);
      render();
    });

    document.getElementById('rename-portfolio-btn')?.addEventListener('click', async () => {
      const p = portfolios.find((x) => x.id === activePortfolioId);
      if (!p) return;
      const name = prompt('Rename portfolio:', p.name);
      if (!name || !name.trim()) return;
      p.name = name.trim();
      await DB.updatePortfolioMeta(p);
      render();
    });

    document.getElementById('delete-portfolio-btn')?.addEventListener('click', async () => {
      if (portfolios.length <= 1) return;
      const p = portfolios.find((x) => x.id === activePortfolioId);
      if (!p) return;
      if (!confirm(`Delete portfolio "${p.name}" and all its holdings? This cannot be undone.`)) return;
      const toRemove = holdings.filter((h) => h.portfolioId === p.id);
      for (const h of toRemove) await DB.removeHolding(h.id);
      await DB.removePortfolioMeta(p.id);
      portfolios = portfolios.filter((x) => x.id !== p.id);
      activePortfolioId = portfolios[0].id;
      await DB.setSetting('activePortfolioId', activePortfolioId);
      await load();
      render();
    });
  }

  async function init(rootEl) {
    root = rootEl;
    await load();
    await ensurePortfolios();
    await resolveActivePortfolio();
    const symbols = holdings.map((h) => h.symbol);
    symbols.forEach((s) => MarketData.addActiveSymbol(s));
    render();
    unsubscribe = MarketData.on('update', () => refreshValues());
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    root = null;
  }

  return { init, destroy };
})();

window.Portfolio = Portfolio;
