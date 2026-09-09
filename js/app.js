// ==============================================================================
// app.js — application shell. Boots MarketData, wires up navigation between
// views, renders the persistent ticker tape and connection/status chrome,
// and owns the Settings view.
// ==============================================================================

const APP_NAME = 'Veyra Markets';

const VIEWS = {
  overview: { label: 'Overview', icon: '◆', module: () => window.Overview },
  watchlist: { label: 'Watchlist', icon: '☰', module: () => window.Watchlist },
  portfolio: { label: 'Portfolio', icon: '◎', module: () => window.Portfolio },
  alerts: { label: 'Alerts', icon: '⚑', module: () => window.Alerts },
  settings: { label: 'Settings', icon: '⚙', module: () => window.SettingsView },
};

let currentView = null;

function cssIdApp(symbol) {
  return symbol.replace(/[^a-zA-Z0-9]/g, '_');
}

// ------------------------------------------------------------- Settings view
const SettingsView = (() => {
  let root = null;
  let customSymbols = [];
  let searchTimer = null;

  async function clearAllData() {
    const stores = Object.values(window.STORES);
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('market-dashboard');
      req.onsuccess = () => resolve(req.result);
    });
    stores.forEach((s) => {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).clear();
    });
    render();
  }

  async function loadCustomSymbols() {
    customSymbols = await DB.getCustomSymbols();
    customSymbols.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  }

  function isAlreadyAvailable(symbol) {
    return MarketData.registry.some((s) => s.symbol === symbol);
  }

  function guessCurrency(symbol) {
    return /\.(NS|BO)$/i.test(symbol) ? 'INR' : 'USD';
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  // ---- Manage companies: search-to-add ----
  function renderCompanySearchResults(results, remoteResults) {
    const box = document.getElementById('company-search-results');
    if (!box) return;
    const combined = [...(results || []), ...(remoteResults || [])].filter((r) => !isAlreadyAvailable(r.symbol));
    const seen = new Set();
    const list = combined.filter((r) => {
      if (seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    });

    if (!list.length) {
      box.innerHTML = `<div class="search-empty dim">No new companies found — it may already be available in Portfolio/Alerts.</div>`;
      box.classList.add('open');
      return;
    }

    box.innerHTML = list
      .slice(0, 8)
      .map(
        (r) => `
        <div class="search-row">
          <div>
            <div class="ticker-name">${r.name}</div>
            <div class="ticker-symbol dim">${r.symbol}${r.exchange ? ' · ' + r.exchange : ''}</div>
          </div>
          <button class="btn-small" data-add-company="${r.symbol}" data-add-name="${escapeAttr(r.name)}">Add</button>
        </div>`
      )
      .join('');
    box.classList.add('open');
  }

  async function addCustomCompany(symbol, name) {
    const shortName = name.length > 24 ? name.split(' ').slice(0, 3).join(' ') : name;
    const entry = {
      symbol,
      name,
      shortName,
      category: 'stock',
      currency: guessCurrency(symbol),
      addedAt: Date.now(),
    };
    await DB.addCustomSymbol(entry);
    MarketData.applyCustomSymbols([entry]);
    await loadCustomSymbols();
    render();
  }

  async function editCustomCompany(symbol) {
    const c = customSymbols.find((s) => s.symbol === symbol);
    if (!c) return;
    const newName = prompt(`Display name for ${symbol}:`, c.shortName || c.name);
    if (newName === null) return; // cancelled
    const trimmed = newName.trim();
    if (!trimmed) return;
    const updated = { ...c, name: trimmed, shortName: trimmed };
    await DB.updateCustomSymbol(updated);
    MarketData.applyCustomSymbols([updated]);
    await loadCustomSymbols();
    render();
  }

  async function deleteCustomCompany(symbol) {
    if (!confirm('Remove this company from Portfolio/Alerts dropdowns? Existing holdings or alerts for it are kept, but will show limited info.')) return;
    await DB.removeCustomSymbol(symbol);
    MarketData.removeCustomSymbol(symbol);
    await loadCustomSymbols();
    render();
  }

  function renderCustomCompaniesList() {
    if (!customSymbols.length) {
      return `<div class="empty-state" style="padding:24px 12px;"><p class="dim">No custom companies added yet. Search above to add one.</p></div>`;
    }
    return `
      <div class="manage-companies-list">
        ${customSymbols
          .map(
            (c) => `
          <div class="company-row" data-symbol="${c.symbol}">
            <div>
              <div class="ticker-name">${c.shortName || c.name}</div>
              <div class="ticker-symbol dim">${c.symbol}</div>
            </div>
            <div class="alert-actions">
              <button class="icon-btn" data-edit-company="${c.symbol}" title="Edit">✎</button>
              <button class="icon-btn" data-delete-company="${c.symbol}" title="Delete">✕</button>
            </div>
          </div>`
          )
          .join('')}
      </div>`;
  }

  function bindCompanyManagement() {
    const input = document.getElementById('company-search-input');
    const box = document.getElementById('company-search-results');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) {
          box?.classList.remove('open');
          return;
        }
        searchTimer = setTimeout(async () => {
          const { results, remoteResults } = await API.search(q);
          renderCompanySearchResults(results, remoteResults);
        }, 250);
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.settings-section .search-wrap')) {
          box?.classList.remove('open');
        }
      });
    }

    // Delegated: the search-results box's innerHTML is replaced on every
    // keystroke, so bind once to the persistent container (see the same
    // fix applied to the Watchlist's Add button).
    box?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-add-company]');
      if (!btn) return;
      const symbol = btn.getAttribute('data-add-company');
      const name = btn.getAttribute('data-add-name');
      btn.textContent = 'Adding…';
      btn.disabled = true;
      await addCustomCompany(symbol, name);
    });

    document.getElementById('custom-companies-list')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-company]');
      if (editBtn) {
        editCustomCompany(editBtn.getAttribute('data-edit-company'));
        return;
      }
      const delBtn = e.target.closest('[data-delete-company]');
      if (delBtn) {
        deleteCustomCompany(delBtn.getAttribute('data-delete-company'));
      }
    });
  }

  function render() {
    if (!root) return;
    root.innerHTML = `
      <div class="view-header"><h2>Settings</h2></div>

      <div class="settings-section">
        <h3>Manage companies</h3>
        <p class="dim">Companies you add here show up in the stock dropdown on both the Portfolio and Alerts pages, with the same live Yahoo Finance data as the built-in list.</p>
        <div class="search-wrap" style="margin-bottom: 14px;">
          <input type="text" id="company-search-input" placeholder="Search company or symbol to add (e.g. Wipro, WIPRO.NS)" autocomplete="off" />
          <div id="company-search-results" class="search-results"></div>
        </div>
        <div id="custom-companies-list">${renderCustomCompaniesList()}</div>
      </div>

      <div class="settings-section">
        <h3>Data source</h3>
        <table class="info-table">
          <tr><td>NIFTY 50 / SENSEX</td><td>Yahoo Finance (unofficial public endpoint)</td></tr>
          <tr><td>Indian stocks</td><td>Yahoo Finance (unofficial public endpoint)</td></tr>
          <tr><td>Gold / Silver</td><td>Yahoo Finance — COMEX futures, quoted in USD/oz</td></tr>
          <tr><td>USD / INR</td><td>Yahoo Finance — INR=X</td></tr>
          <tr><td>Custom companies (added above)</td><td>Yahoo Finance, same as the built-in list</td></tr>
        </table>
        <p class="dim">See the README for full details on data status (delayed vs. real-time) and free-tier limits.</p>
      </div>

      <div class="settings-section">
        <h3>Refresh behaviour</h3>
        <p class="dim">Prices auto-refresh via polling: every 10 seconds while the Indian market is open, every 45 seconds otherwise. No manual refresh is required.</p>
        <button class="btn-secondary" id="force-refresh">Refresh now</button>
      </div>

      <div class="settings-section">
        <h3>Local data</h3>
        <p class="dim">Your watchlist, portfolios, alerts, custom companies and cached "last known" prices are stored only in this browser via IndexedDB — nothing is sent to a server other than price requests.</p>
        <button class="btn-danger" id="clear-data">Clear all local data</button>
      </div>
    `;
    document.getElementById('force-refresh')?.addEventListener('click', () => MarketData.forceRefresh());
    document.getElementById('clear-data')?.addEventListener('click', () => {
      if (confirm('This removes your watchlist, portfolios, alerts, custom companies and cached data from this browser. Continue?')) {
        clearAllData();
      }
    });
    bindCompanyManagement();
  }

  async function init(rootEl) {
    root = rootEl;
    await loadCustomSymbols();
    render();
  }
  function destroy() {
    root = null;
  }
  return { init, destroy };
})();
window.SettingsView = SettingsView;

// ------------------------------------------------------------- Ticker tape
function renderTickerTape() {
  const el = document.getElementById('ticker-tape-inner');
  if (!el) return;
  const symbols = MarketData.getCoreSymbols();
  const html = symbols
    .map((symbol) => {
      const meta = MarketData.getMeta(symbol);
      const q = MarketData.get(symbol);
      const cls = q.change > 0 ? 'positive' : q.change < 0 ? 'negative' : 'neutral';
      const sign = q.change > 0 ? '+' : '';
      const priceStr =
        q.price != null
          ? q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })
          : '—';
      const changeStr = q.changePercent != null ? `${sign}${q.changePercent.toFixed(2)}%` : '';
      return `<span class="ticker-item"><strong>${meta.shortName}</strong> ${priceStr} <span class="${cls}">${changeStr}</span></span>`;
    })
    .join('<span class="ticker-sep">·</span>');
  // duplicate content for a seamless CSS marquee loop
  el.innerHTML = html + '<span class="ticker-sep">·</span>' + html;
}

// -------------------------------------------------------- Connection status
function setConnectionStatus(ok) {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;
  dot.className = 'conn-dot ' + (ok ? 'ok' : 'down');
  label.textContent = ok ? 'Connected' : 'Connection issue — showing last known data';
}

// --------------------------------------------------------------- Clock/IST
function tickClock() {
  const el = document.getElementById('ist-clock');
  if (el) el.textContent = MarketStatus.formatISTClock() + ' IST';
}

// ------------------------------------------------------------------ Router
async function showView(name) {
  const container = document.getElementById('view-container');
  const def = VIEWS[name];
  if (!def) return;

  if (currentView && VIEWS[currentView] && VIEWS[currentView].module()) {
    VIEWS[currentView].module().destroy();
  }

  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  container.innerHTML = '';
  currentView = name;
  await def.module().init(container);
  localStorage.setItem('md-last-view', name); // UI convenience only, not app data
}

function buildNav() {
  const nav = document.getElementById('nav-rail');
  nav.innerHTML = Object.entries(VIEWS)
    .map(([key, def]) => `<button class="nav-btn" data-view="${key}" title="${def.label}"><span class="nav-icon">${def.icon}</span><span class="nav-label">${def.label}</span></button>`)
    .join('') + `<button class="nav-btn nav-landing" id="nav-landing" title="Landing page"><span class="nav-icon">↗</span><span class="nav-label">Home</span></button>`;
  nav.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
  document.getElementById('nav-landing')?.addEventListener('click', showLandingPage);
}

// ------------------------------------------------------------- Landing page
function showLandingPage() {
  const landing = document.getElementById('landing-page');
  const shell = document.getElementById('app-shell');
  if (!landing || !shell) return;
  landing.classList.remove('is-hidden');
  shell.classList.add('is-hidden');
}

function showDashboard() {
  const landing = document.getElementById('landing-page');
  const shell = document.getElementById('app-shell');
  if (!landing || !shell) return;
  landing.classList.add('is-hidden');
  shell.classList.remove('is-hidden');
}

function wireLanding() {
  document.getElementById('enter-dashboard')?.addEventListener('click', showDashboard);
}

// --------------------------------------------------------------------- Boot
async function boot() {
  wireLanding();
  buildNav();
  setInterval(tickClock, 1000);
  tickClock();

  MarketData.on('update', renderTickerTape);
  MarketData.on('update', () => {
    const q = MarketData.get('^BSESN');
    const valueEl = document.querySelector('.landing-preview .preview-value');
    if (!valueEl || q?.price == null) return;
    const change = q.changePercent;
    const sign = change > 0 ? '+' : '';
    valueEl.innerHTML = `${Number(q.price).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <i>${change == null ? '' : `${sign}${Number(change).toFixed(2)}%`}</i>`;
  });
  MarketData.on('connection', (e) => setConnectionStatus(e.detail.ok));
  MarketData.on('server-unreachable', () => {
    document.getElementById('view-container').innerHTML = `
      <div class="empty-state">
        <p><strong>Cannot reach the dashboard's backend server.</strong></p>
        <p class="dim">Make sure the server is running (see README: "npm start") and reload this page.</p>
      </div>`;
  });

  await MarketData.loadRegistry();
  MarketData.applyCustomSymbols(await DB.getCustomSymbols());

  // Build the initial active-symbol set from persisted user data so prices
  // for watchlist/portfolio/alert symbols are ready before those views open.
  const [watchlist, portfolio, alerts] = await Promise.all([DB.getWatchlist(), DB.getPortfolio(), DB.getAlerts()]);
  const initialSymbols = new Set(MarketData.getCoreSymbols());
  watchlist.forEach((w) => initialSymbols.add(w.symbol));
  portfolio.forEach((p) => initialSymbols.add(p.symbol));
  alerts.forEach((a) => initialSymbols.add(a.symbol));

  await MarketData.start(Array.from(initialSymbols));
  renderTickerTape();
  await Alerts.startBackgroundWatch();

  // The landing page is always the first screen on a fresh page load.
  // Do not restore the previous dashboard view until the user explicitly
  // enters the dashboard from the landing CTA. This prevents the dashboard
  // from appearing underneath/alongside the landing page on first load.
  await showView('overview');
  showLandingPage();
}

document.addEventListener('DOMContentLoaded', boot);
