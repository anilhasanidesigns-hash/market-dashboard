// ==============================================================================
// Symbol registry — single source of truth for every instrument this app knows
// about. The server uses this to validate incoming symbol requests (so the
// proxy can't be used as an open relay to arbitrary Yahoo Finance symbols).
// The client's js/market-data.js mirrors the *shape* of this data for display
// purposes, but always gets live numeric data from the server, never invents it.
// ==============================================================================

/**
 * category: 'index' | 'stock' | 'commodity' | 'currency'
 * symbol:   the exact ticker Yahoo Finance's chart API expects
 * currency: the currency the raw price is quoted in (for correct display)
 */
const SYMBOLS = [
  { symbol: '^NSEI', name: 'NIFTY 50', shortName: 'NIFTY 50', category: 'index', currency: 'INR' },
  { symbol: '^BSESN', name: 'S&P BSE SENSEX', shortName: 'SENSEX', category: 'index', currency: 'INR' },

  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd', shortName: 'Reliance Industries', category: 'stock', currency: 'INR' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services Ltd', shortName: 'TCS', category: 'stock', currency: 'INR' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', shortName: 'Infosys', category: 'stock', currency: 'INR' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', shortName: 'HDFC Bank', category: 'stock', currency: 'INR' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd', shortName: 'ICICI Bank', category: 'stock', currency: 'INR' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', shortName: 'SBI', category: 'stock', currency: 'INR' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd', shortName: 'Bharti Airtel', category: 'stock', currency: 'INR' },
  { symbol: 'ITC.NS', name: 'ITC Ltd', shortName: 'ITC', category: 'stock', currency: 'INR' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro Ltd', shortName: 'Larsen & Toubro', category: 'stock', currency: 'INR' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd', shortName: 'Tata Motors', category: 'stock', currency: 'INR' },

  // Gold/Silver: COMEX front-month futures, quoted in USD per troy ounce.
  // This is the most reliable free, keyless source. It is NOT MCX INR gold —
  // see README "Data Status" for exactly what this number represents.
  { symbol: 'GC=F', name: 'Gold Futures (COMEX)', shortName: 'Gold', category: 'commodity', currency: 'USD' },
  { symbol: 'SI=F', name: 'Silver Futures (COMEX)', shortName: 'Silver', category: 'commodity', currency: 'USD' },

  { symbol: 'INR=X', name: 'USD / INR', shortName: 'USD/INR', category: 'currency', currency: 'INR' },
];

const SYMBOL_SET = new Set(SYMBOLS.map((s) => s.symbol));

function isKnownSymbol(symbol) {
  return SYMBOL_SET.has(symbol);
}

function getMeta(symbol) {
  return SYMBOLS.find((s) => s.symbol === symbol) || null;
}

// The app now lets a user add their own "custom companies" from Settings
// (see js/db.js customSymbols store), which are not part of the curated
// SYMBOLS list above. Those still need to reach Yahoo Finance for live
// quotes/charts, so quote/chart routes accept any symbol matching this
// shape instead of only the fixed registry. This is still a real
// allowlist — it blocks anything that isn't a plausible ticker (no path
// separators, no whitespace, no script-y characters) — it just no longer
// requires the symbol to be one we shipped ourselves.
const SAFE_SYMBOL_PATTERN = /^[A-Za-z0-9.^=_-]{1,20}$/;

function isValidSymbolFormat(symbol) {
  return typeof symbol === 'string' && SAFE_SYMBOL_PATTERN.test(symbol);
}

module.exports = { SYMBOLS, isKnownSymbol, getMeta, isValidSymbolFormat };
