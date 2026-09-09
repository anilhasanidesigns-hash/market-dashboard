// ==============================================================================
// Market Dashboard — backend proxy
// ==============================================================================
// Why a backend exists at all, given no API key is required by default:
//  1. Yahoo Finance's endpoints reject/CORS-block direct browser calls in most
//     environments, so a same-origin server-side proxy is required regardless
//     of whether a secret is involved.
//  2. It gives us one place to rate-limit, cache, validate symbols, and — if
//     you add a keyed provider later (see server/providers) — one place to
//     keep that key server-side, never shipped to the browser.
// ==============================================================================

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const yahoo = require('./providers/yahooFinance');
const { SYMBOLS, isKnownSymbol, isValidSymbolFormat } = require('./symbols');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ------------------------------------------------------------------ helpers
const RANGE_MAP = {
  '1D': { range: '1d', interval: '2m' },
  '1W': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
};

// Very small fixed-window limiter per IP to keep us polite to the upstream
// provider and avoid getting temporarily blocked. Not meant to be
// production-grade, just responsible.
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const windowMs = 10_000;
  const max = 40;
  const bucket = hits.get(key) || { count: 0, start: now };
  if (now - bucket.start > windowMs) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  hits.set(key, bucket);
  if (bucket.count > max) {
    return res.status(429).json({ error: 'Rate limit exceeded, slow down.' });
  }
  next();
}

app.use('/api', rateLimit);

// --------------------------------------------------------------------- API

// List every instrument the app knows about (for building the UI / search fallback)
app.get('/api/symbols', (req, res) => {
  res.json({ symbols: SYMBOLS });
});

// Batch quote — used for the overview cards, watchlist rows, ticker strip
app.get('/api/quotes', async (req, res) => {
  const raw = (req.query.symbols || '').toString();
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!symbols.length) {
    return res.status(400).json({ error: 'symbols query param is required' });
  }
  if (symbols.length > 30) {
    return res.status(400).json({ error: 'Too many symbols in one request (max 30)' });
  }

  const unknown = symbols.filter((s) => !isKnownSymbol(s) && !isValidSymbolFormat(s));
  if (unknown.length) {
    return res.status(400).json({ error: `Unknown symbol(s): ${unknown.join(', ')}` });
  }

  try {
    const results = await Promise.all(symbols.map((s) => yahoo.getChart(s, '1d', '2m')));
    const bySymbol = {};
    results.forEach((r) => {
      bySymbol[r.symbol] = r;
    });
    res.json({ quotes: bySymbol, serverTime: Date.now() });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch quotes', detail: err.message });
  }
});

// Historical chart for one symbol at a given period (1D/1W/1M/3M/1Y)
app.get('/api/chart/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const period = (req.query.period || '1D').toUpperCase();

  if (!isKnownSymbol(symbol) && !isValidSymbolFormat(symbol)) {
    return res.status(400).json({ error: `Unknown symbol: ${symbol}` });
  }
  const conf = RANGE_MAP[period];
  if (!conf) {
    return res.status(400).json({ error: `Unknown period: ${period}. Use 1D, 1W, 1M, 3M or 1Y.` });
  }

  try {
    const data = await yahoo.getChart(symbol, conf.range, conf.interval);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch chart', detail: err.message });
  }
});

// Stock/instrument search — company name or symbol
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });

  // Always search the local known-instrument universe first (fast, reliable,
  // and guaranteed to only surface symbols this app can actually chart).
  const local = SYMBOLS.filter(
    (s) =>
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      s.shortName.toLowerCase().includes(q.toLowerCase()) ||
      s.symbol.toLowerCase().includes(q.toLowerCase())
  ).map((s) => ({ symbol: s.symbol, name: s.name, exchange: 'NSE/BSE', type: s.category, known: true }));

  // Optionally enrich with live Yahoo search results for symbols outside our
  // curated list (shown as "not trackable yet" in the UI, never faked).
  const remote = await yahoo.searchSymbols(q);

  res.json({
    results: local,
    remoteResults: remote || [],
    remoteSearchAvailable: remote !== null,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ----------------------------------------------------------- static files
const ROOT = path.join(__dirname, '..');
app.use(express.static(ROOT));

app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Veyra Markets running at http://localhost:${PORT}`);
});
