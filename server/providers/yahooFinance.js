// ==============================================================================
// Yahoo Finance provider
// ==============================================================================
// This talks to Yahoo Finance's public "chart" endpoint, which is UNOFFICIAL
// and undocumented, but does not require an API key and is widely used for
// this exact purpose. We deliberately use ONLY the /v8/finance/chart endpoint
// (never /v7/finance/quote) because Yahoo now requires a signed "crumb" +
// cookie for /quote, while /chart still returns a rich `meta` block
// (current price, previous close, day high/low, market state, currency,
// long/short name) alongside the historical series — so one endpoint covers
// both "current quote" and "historical chart" needs.
//
// Every function here returns either real parsed data, or throws / returns
// null. Nothing in this file fabricates a price. Callers are responsible for
// translating a failure into an honest "DATA UNAVAILABLE" state — never a
// guess.
// ==============================================================================

const fetch = require('node-fetch');

const BASE_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
};

// Simple in-memory cache to avoid hammering Yahoo and to have "last known
// data" available if a subsequent request fails. TTL is intentionally short.
const cache = new Map(); // key -> { data, ts }

function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) return null;
  return hit.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function lastKnown(key) {
  const hit = cache.get(key);
  return hit ? { data: hit.data, asOf: hit.ts } : null;
}

async function fetchJsonWithFallbackHost(path) {
  let lastErr;
  for (const host of BASE_HOSTS) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: COMMON_HEADERS,
        timeout: 8000,
      });
      if (!res.ok) {
        lastErr = new Error(`Upstream ${host} responded ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All upstream hosts failed');
}

/**
 * Fetch the chart payload for one symbol.
 * range/interval follow Yahoo's vocabulary, e.g.:
 *   1D -> range=1d,  interval=2m
 *   1W -> range=5d,  interval=15m
 *   1M -> range=1mo, interval=1d
 *   3M -> range=3mo, interval=1d
 *   1Y -> range=1y,  interval=1wk
 */
async function getChart(symbol, range = '1d', interval = '2m') {
  const cacheKey = `chart:${symbol}:${range}:${interval}`;
  const cached = cacheGet(cacheKey, 10_000); // 10s freshness window
  if (cached) return { ...cached, fromCache: true };

  const path = `/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=false`;

  try {
    const json = await fetchJsonWithFallbackHost(path);
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta) {
      throw new Error('Empty/unexpected payload from provider');
    }

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};

    const series = timestamps.map((t, i) => ({
      t: t * 1000,
      close: quote.close ? quote.close[i] : null,
      open: quote.open ? quote.open[i] : null,
      high: quote.high ? quote.high[i] : null,
      low: quote.low ? quote.low[i] : null,
      volume: quote.volume ? quote.volume[i] : null,
    })).filter((p) => p.close !== null && p.close !== undefined);

    const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    const prevClose =
      typeof meta.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : typeof meta.previousClose === 'number'
        ? meta.previousClose
        : null;

    const change = price !== null && prevClose !== null ? price - prevClose : null;
    const changePct = price !== null && prevClose ? (change / prevClose) * 100 : null;

    const payload = {
      symbol,
      currency: meta.currency || null,
      exchangeName: meta.exchangeName || null,
      longName: meta.longName || meta.shortName || null,
      shortName: meta.shortName || null,
      marketState: meta.marketState || null, // PRE, REGULAR, POST, CLOSED, POSTPOST
      price,
      previousClose: prevClose,
      dayHigh: typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : null,
      dayLow: typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : null,
      change,
      changePercent: changePct,
      regularMarketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
      timezone: meta.exchangeTimezoneName || null,
      series,
      fetchedAt: Date.now(),
      status: 'LIVE',
    };

    cacheSet(cacheKey, payload);
    return payload;
  } catch (err) {
    const stale = lastKnown(cacheKey);
    if (stale) {
      return { ...stale.data, status: 'LAST_KNOWN', asOf: stale.asOf, error: err.message };
    }
    return { symbol, status: 'UNAVAILABLE', error: err.message };
  }
}

async function searchSymbols(query) {
  const path = `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  try {
    const json = await fetchJsonWithFallbackHost(path);
    const quotes = (json && json.quotes) || [];
    return quotes
      .filter((q) => q.symbol)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchange || null,
        type: q.quoteType || null,
      }));
  } catch (err) {
    return null; // caller falls back to local static search
  }
}

module.exports = { getChart, searchSymbols };
