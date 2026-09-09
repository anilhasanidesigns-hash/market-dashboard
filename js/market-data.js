// ==============================================================================
// market-data.js — live price state manager.
//
// This is the ONLY module in the app that owns "what is the current price".
// Every other module (watchlist, portfolio, alerts, charts, overview) reads
// from here. It is intentionally strict about honesty:
//
//   status: 'LIVE'        -> price came back from the provider just now
//   status: 'LAST_KNOWN'  -> provider call failed, showing IndexedDB cache
//   status: 'UNAVAILABLE' -> provider call failed AND no cache exists
//
// A UI element bound to a symbol must always show one of these three states
// truthfully. Nothing here ever invents or randomizes a number.
// ==============================================================================

const MarketData = (() => {
  const bus = new EventTarget();
  const state = new Map(); // symbol -> latest payload (with status)
  let symbolRegistry = [];
  let pollTimer = null;
  let activeSymbols = new Set();
  let currentIntervalMs = 15000;
  let inFlight = false;

  function on(eventName, handler) {
    bus.addEventListener(eventName, handler);
    return () => bus.removeEventListener(eventName, handler);
  }

  function emit(eventName, detail) {
    bus.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  async function loadRegistry() {
    if (symbolRegistry.length) return symbolRegistry;
    try {
      symbolRegistry = await API.getSymbols();
    } catch (err) {
      // The registry is static metadata shipped with the server; if even this
      // fails, the server itself is unreachable. Surface that clearly.
      emit('server-unreachable', { error: err.message });
      symbolRegistry = [];
    }
    return symbolRegistry;
  }

  function getMeta(symbol) {
    return symbolRegistry.find((s) => s.symbol === symbol) || null;
  }

  // Merge user-added "custom companies" (Settings > Manage companies) into
  // the registry. Every other module (Portfolio's stock dropdown, Alerts'
  // instrument dropdown, price polling) reads symbols from this same
  // registry, so once merged here a custom company behaves exactly like a
  // built-in one — same live Yahoo-backed quotes, same getMeta() lookups.
  function applyCustomSymbols(list) {
    (list || []).forEach((entry) => {
      const idx = symbolRegistry.findIndex((s) => s.symbol === entry.symbol);
      if (idx >= 0) symbolRegistry[idx] = { ...symbolRegistry[idx], ...entry };
      else symbolRegistry.push(entry);
    });
    emit('registry-updated', { symbols: (list || []).map((e) => e.symbol) });
  }

  function removeCustomSymbol(symbol) {
    symbolRegistry = symbolRegistry.filter((s) => s.symbol !== symbol);
    emit('registry-updated', { symbols: [symbol] });
  }

  function getCoreSymbols() {
    return symbolRegistry
      .filter((s) => s.category === 'index' || s.category === 'commodity' || s.category === 'currency')
      .map((s) => s.symbol);
  }

  function getAllStockSymbols() {
    return symbolRegistry.filter((s) => s.category === 'stock').map((s) => s.symbol);
  }

  function get(symbol) {
    return state.get(symbol) || { symbol, status: 'UNAVAILABLE' };
  }

  function setActiveSymbols(symbols) {
    activeSymbols = new Set(symbols);
  }

  function addActiveSymbol(symbol) {
    activeSymbols.add(symbol);
  }

  async function pollOnce() {
    if (inFlight) return;
    if (!activeSymbols.size) return;
    inFlight = true;

    const symbols = Array.from(activeSymbols).slice(0, 30);
    try {
      const { quotes, serverTime } = await API.getQuotes(symbols);
      for (const symbol of symbols) {
        const q = quotes[symbol];
        if (!q) continue;

        if (q.status === 'LIVE' || q.status === 'LAST_KNOWN') {
          state.set(symbol, q);
          if (q.status === 'LIVE') {
            DB.cacheQuote(symbol, q).catch(() => {});
          }
        } else {
          // Provider says unavailable right now — fall back to our own
          // IndexedDB cache before declaring it fully unavailable.
          const cached = await DB.getCachedQuote(symbol);
          if (cached) {
            state.set(symbol, { ...cached.quote, status: 'LAST_KNOWN', asOf: cached.cachedAt });
          } else {
            state.set(symbol, { symbol, status: 'UNAVAILABLE', error: q.error });
          }
        }
      }
      emit('update', { symbols, serverTime });
      emit('connection', { ok: true });
    } catch (err) {
      // Whole request failed (network down, server down, rate limited).
      // Fall back to cache per-symbol so the UI can show "Last known data".
      for (const symbol of symbols) {
        const cached = await DB.getCachedQuote(symbol);
        if (cached) {
          state.set(symbol, { ...cached.quote, status: 'LAST_KNOWN', asOf: cached.cachedAt });
        } else if (!state.has(symbol)) {
          state.set(symbol, { symbol, status: 'UNAVAILABLE', error: err.message });
        }
      }
      emit('update', { symbols, serverTime: Date.now() });
      emit('connection', { ok: false, error: err.message });
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      await pollOnce();
      recomputeInterval();
      scheduleNext();
    }, currentIntervalMs);
  }

  function recomputeInterval() {
    // Poll faster while the Indian market is open (most of our symbols are
    // Indian equities/indices); slower otherwise to be a good API citizen.
    // Gold/Silver/USD-INR trade near round-the-clock so we never go fully
    // idle — just slower.
    const status = MarketStatus.estimateStatusFromClock();
    currentIntervalMs = status.state === 'OPEN' ? 10000 : 45000;
  }

  async function start(initialSymbols) {
    await loadRegistry();
    setActiveSymbols(initialSymbols);
    recomputeInterval();
    await pollOnce();
    scheduleNext();
  }

  function forceRefresh() {
    return pollOnce();
  }

  async function getChart(symbol, period) {
    return API.getChart(symbol, period);
  }

  return {
    on,
    loadRegistry,
    getMeta,
    applyCustomSymbols,
    removeCustomSymbol,
    getCoreSymbols,
    getAllStockSymbols,
    get,
    setActiveSymbols,
    addActiveSymbol,
    start,
    forceRefresh,
    getChart,
    get registry() {
      return symbolRegistry;
    },
  };
})();

window.MarketData = MarketData;
