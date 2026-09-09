// ==============================================================================
// db.js — IndexedDB persistence layer.
//
// IndexedDB is NOT a data source. It never supplies a live price. It exists
// purely for: watchlist membership, portfolio holdings, alert rules, user
// settings, recently-viewed symbols, and a short-lived cache of the last
// successfully fetched quote per symbol (used only to render "Last known
// data — HH:MM:SS" when the network/provider is unavailable).
// ==============================================================================

const DB_NAME = 'market-dashboard';
const DB_VERSION = 2;

const STORES = {
  watchlist: 'watchlist', // keyPath: symbol
  portfolio: 'portfolio', // keyPath: id (autoincrement) — each holding also carries a portfolioId
  alerts: 'alerts', // keyPath: id (autoincrement)
  settings: 'settings', // keyPath: key
  recents: 'recents', // keyPath: symbol
  quoteCache: 'quoteCache', // keyPath: symbol
  customSymbols: 'customSymbols', // keyPath: symbol — user-added companies (Settings > Manage companies)
  portfolios: 'portfolios', // keyPath: id (autoincrement) — { id, name, createdAt }, one row per named portfolio
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.watchlist)) {
        db.createObjectStore(STORES.watchlist, { keyPath: 'symbol' });
      }
      if (!db.objectStoreNames.contains(STORES.portfolio)) {
        db.createObjectStore(STORES.portfolio, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.alerts)) {
        db.createObjectStore(STORES.alerts, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.recents)) {
        db.createObjectStore(STORES.recents, { keyPath: 'symbol' });
      }
      if (!db.objectStoreNames.contains(STORES.quoteCache)) {
        db.createObjectStore(STORES.quoteCache, { keyPath: 'symbol' });
      }
      if (!db.objectStoreNames.contains(STORES.customSymbols)) {
        db.createObjectStore(STORES.customSymbols, { keyPath: 'symbol' });
      }
      if (!db.objectStoreNames.contains(STORES.portfolios)) {
        db.createObjectStore(STORES.portfolios, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---- generic helpers ----
  async getAll(storeName) {
    const store = await tx(storeName);
    return promisifyRequest(store.getAll());
  },
  async get(storeName, key) {
    const store = await tx(storeName);
    return promisifyRequest(store.get(key));
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.put(value));
  },
  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return promisifyRequest(store.delete(key));
  },

  // ---- watchlist ----
  getWatchlist() {
    return DB.getAll(STORES.watchlist);
  },
  addToWatchlist(symbol, meta) {
    return DB.put(STORES.watchlist, { symbol, ...meta, addedAt: Date.now() });
  },
  removeFromWatchlist(symbol) {
    return DB.delete(STORES.watchlist, symbol);
  },

  // ---- portfolio ----
  getPortfolio() {
    return DB.getAll(STORES.portfolio);
  },
  addHolding(holding) {
    return DB.put(STORES.portfolio, holding);
  },
  updateHolding(holding) {
    return DB.put(STORES.portfolio, holding);
  },
  removeHolding(id) {
    return DB.delete(STORES.portfolio, id);
  },

  // ---- alerts ----
  getAlerts() {
    return DB.getAll(STORES.alerts);
  },
  addAlert(alert) {
    return DB.put(STORES.alerts, alert);
  },
  updateAlert(alert) {
    return DB.put(STORES.alerts, alert);
  },
  removeAlert(id) {
    return DB.delete(STORES.alerts, id);
  },

  // ---- settings ----
  async getSetting(key, fallback = null) {
    const row = await DB.get(STORES.settings, key);
    return row ? row.value : fallback;
  },
  setSetting(key, value) {
    return DB.put(STORES.settings, { key, value });
  },

  // ---- recents ----
  async pushRecent(symbol, name) {
    await DB.put(STORES.recents, { symbol, name, viewedAt: Date.now() });
    const all = await DB.getAll(STORES.recents);
    if (all.length > 15) {
      all
        .sort((a, b) => a.viewedAt - b.viewedAt)
        .slice(0, all.length - 15)
        .forEach((r) => DB.delete(STORES.recents, r.symbol));
    }
  },
  getRecents() {
    return DB.getAll(STORES.recents).then((rows) => rows.sort((a, b) => b.viewedAt - a.viewedAt));
  },

  // ---- quote cache (last known data fallback only) ----
  cacheQuote(symbol, quote) {
    return DB.put(STORES.quoteCache, { symbol, quote, cachedAt: Date.now() });
  },
  getCachedQuote(symbol) {
    return DB.get(STORES.quoteCache, symbol);
  },

  // ---- custom symbols (companies the user added from Settings) ----
  getCustomSymbols() {
    return DB.getAll(STORES.customSymbols);
  },
  addCustomSymbol(entry) {
    return DB.put(STORES.customSymbols, entry);
  },
  updateCustomSymbol(entry) {
    return DB.put(STORES.customSymbols, entry);
  },
  removeCustomSymbol(symbol) {
    return DB.delete(STORES.customSymbols, symbol);
  },

  // ---- multiple named portfolios ----
  getPortfolios() {
    return DB.getAll(STORES.portfolios);
  },
  addPortfolioMeta(name) {
    return DB.put(STORES.portfolios, { name, createdAt: Date.now() });
  },
  updatePortfolioMeta(portfolioMeta) {
    return DB.put(STORES.portfolios, portfolioMeta);
  },
  removePortfolioMeta(id) {
    return DB.delete(STORES.portfolios, id);
  },
};

window.DB = DB;
window.STORES = STORES;
