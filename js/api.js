// ==============================================================================
// api.js — thin client for the backend proxy
// ==============================================================================

const API_BASE = 'https://market-dashboard-qv0j.onrender.com';

const API = {
  async getSymbols() {
    const res = await fetch(`${API_BASE}/api/symbols`);
    if (!res.ok) throw new Error(`symbols request failed: ${res.status}`);
    const json = await res.json();
    return json.symbols;
  },

  async getQuotes(symbols) {
    const qs = encodeURIComponent(symbols.join(','));
    const res = await fetch(`${API_BASE}/api/quotes?symbols=${qs}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `quotes request failed: ${res.status}`);
    }
    return res.json();
  },

  async getChart(symbol, period) {
    const res = await fetch(
      `${API_BASE}/api/chart/${encodeURIComponent(symbol)}?period=${encodeURIComponent(period)}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `chart request failed: ${res.status}`);
    }
    return res.json();
  },

  async search(query) {
    const res = await fetch(
      `${API_BASE}/api/search?q=${encodeURIComponent(query)}`
    );
    if (!res.ok) throw new Error(`search request failed: ${res.status}`);
    return res.json();
  },

  async health() {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  },
};

window.API = API;