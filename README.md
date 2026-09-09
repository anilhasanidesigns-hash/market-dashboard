# Veyra Markets

A real-time-ish Indian market monitoring dashboard: **NIFTY 50 · SENSEX · 10 major
Indian stocks · Gold · Silver · USD/INR** — live prices, intraday/historical
charts, a persistent watchlist, a manual portfolio tracker, and price alerts.

No data on this dashboard is invented. Anywhere real data can't be fetched,
the UI says so explicitly (`DATA UNAVAILABLE` or `LAST KNOWN DATA · <time>`)
instead of guessing.

---

## Installation

```bash
git clone <this project>          # or unzip the project folder
cd market-dashboard
npm install
cp .env.example .env               # optional — the app works with zero keys
```

## Run

```bash
npm start
```

Then open **http://localhost:3000**.

The app starts and works correctly with **no API key configured at all** —
see "Data Providers" below for why.

---

## Data Providers

| Market data | Provider | Symbol(s) used |
|---|---|---|
| NIFTY 50 | Yahoo Finance (public chart endpoint) | `^NSEI` |
| SENSEX | Yahoo Finance (public chart endpoint) | `^BSESN` |
| Indian stocks (Reliance, TCS, Infosys, HDFC Bank, ICICI Bank, SBI, Bharti Airtel, ITC, L&T, Tata Motors) | Yahoo Finance (public chart endpoint) | `RELIANCE.NS`, `TCS.NS`, `INFY.NS`, `HDFCBANK.NS`, `ICICIBANK.NS`, `SBIN.NS`, `BHARTIARTL.NS`, `ITC.NS`, `LT.NS`, `TATAMOTORS.NS` |
| Gold | Yahoo Finance — **COMEX gold futures**, quoted in **USD per troy ounce** | `GC=F` |
| Silver | Yahoo Finance — **COMEX silver futures**, quoted in **USD per troy ounce** | `SI=F` |
| USD/INR | Yahoo Finance (public chart endpoint) | `INR=X` |

All of the above is fetched **server-side**, from Yahoo Finance's public
`/v8/finance/chart/{symbol}` endpoint (`server/providers/yahooFinance.js`).
This endpoint requires **no API key**, which is why the app works out of
the box.

**Important honesty note:** this is an *unofficial, undocumented* public
endpoint, not a paid/contracted data feed. It is widely relied on for
exactly this purpose, but Yahoo can change or rate-limit it without notice.
If it becomes unavailable, the dashboard will show `DATA UNAVAILABLE` /
`LAST KNOWN DATA`, not fabricated numbers — see `server/providers/`,
which is intentionally modular so you can swap in a different provider
(Twelve Data, Alpha Vantage, NSE's own data feed, a broker API, etc.)
without touching the frontend.

**Gold/Silver caveat:** `GC=F`/`SI=F` are **international COMEX futures in
USD**, not MCX gold/silver in INR. If you specifically need MCX INR spot/
futures prices, wire up a provider that supplies them (e.g. via a broker
API or a commodities data vendor) in `server/providers/` — the `.env.example`
file has a placeholder for `METALS_API_KEY` for this purpose.

### Data Status

| Source | Status |
|---|---|
| NIFTY 50 / SENSEX | Near real-time (Yahoo's typical Indian-index latency is roughly seconds, not guaranteed exchange-tick real-time) |
| Indian stocks | Near real-time, same caveat as above |
| Gold / Silver (COMEX futures) | Near real-time during COMEX trading hours; static outside them |
| USD/INR | Near real-time |

The UI never claims `LIVE` unless the most recent fetch for that symbol
just succeeded. Every price also shows its own **Last Updated** timestamp
(from the provider's own `regularMarketTime`, not just "when we polled"),
so you can judge staleness yourself.

### API Keys

You do not need to add anything to `.env` for the default setup to work.
`.env.example` documents two **optional** fallback provider keys
(`TWELVE_DATA_API_KEY`, `METALS_API_KEY`) that are not wired up by default —
they exist as a documented extension point if you want to add a second,
keyed provider for redundancy. Copy `.env.example` to `.env` and fill them
in only if you extend `server/providers/` to use them.

### Free Tier / Rate Limits

- The Yahoo Finance endpoint used has no published, official rate limit
  (it's unofficial), but the server includes its own conservative rate
  limiter (40 requests per IP per 10 seconds) and a 10-second response
  cache per symbol/range/interval to avoid hammering it.
- Polling frequency: every **10 seconds** while the Indian market is open,
  every **45 seconds** otherwise (see `js/market-data.js`).
- If you wire up Twelve Data as a fallback: free tier is 8 requests/minute,
  800/day (subject to change — verify at twelvedata.com/pricing).

---

## Architecture

```
Browser (HTML/CSS/vanilla JS)
   │  fetch('/api/...')
   ▼
Express server (server/server.js)
   │  validates symbol, rate-limits, caches
   ▼
server/providers/yahooFinance.js
   │  HTTPS
   ▼
Yahoo Finance public chart endpoint
```

- **Frontend**: plain HTML/CSS/JS, no build step, no framework. IndexedDB
  (`js/db.js`) is the local persistence layer for watchlist, portfolio,
  alerts, settings, recents, and a short-lived "last known quote" cache —
  it never supplies a live price itself.
- **Backend**: a small Express server that proxies Yahoo Finance (required
  for CORS reasons regardless of the "no key" situation), validates
  requested symbols against a fixed registry (`server/symbols.js`), rate
  limits, and serves the static frontend.
- **Real-time strategy**: polling, not WebSocket. Yahoo Finance's free
  public endpoints don't expose a documented, keyless streaming/WebSocket
  API, so this app polls on an adaptive interval instead of claiming a
  streaming connection it doesn't have. `js/market-data.js` is the single
  place price state lives; it's structured so a WebSocket-based provider
  could replace the polling loop later without changing any UI code.

## Project Structure

```
market-dashboard/
├── index.html
├── package.json
├── README.md
├── .env.example
│
├── css/
│   └── styles.css
│
├── js/
│   ├── app.js            # shell: nav, ticker tape, settings, boot
│   ├── db.js              # IndexedDB persistence
│   ├── api.js              # fetch wrapper for the backend
│   ├── market-data.js       # live price state + polling
│   ├── market-status.js      # IST market-hours calculation
│   ├── charts.js               # dependency-free canvas line chart
│   ├── overview.js              # NIFTY/SENSEX/Gold/Silver/USD-INR dashboard
│   ├── watchlist.js               # watchlist CRUD + search + stock detail
│   ├── portfolio.js                 # manual holdings tracker
│   └── alerts.js                     # price alert rules + notifications
│
└── server/
    ├── server.js           # Express app + API routes
    ├── symbols.js           # instrument registry (single source of truth)
    └── providers/
        └── yahooFinance.js   # Yahoo Finance chart-endpoint client
```

## Extending the tracked universe

Every instrument the app can display lives in **one file**:
`server/symbols.js`. To track another stock, add an entry there with its
Yahoo Finance symbol (e.g. `WIPRO.NS`) — the search box, watchlist,
portfolio dropdown, and alert dropdown all read from this registry
automatically, no other code changes required.

## What this app deliberately does NOT do

- It does not place real trades. The portfolio tracker is a manual
  quantity/buy-price ledger only.
- It does not show fake/simulated prices, ever, under any failure
  condition — see `DATA UNAVAILABLE` / `LAST KNOWN DATA` handling in
  `js/market-data.js`.
- It does not know about NSE/BSE holidays for its clock-based market-status
  fallback (`js/market-status.js`); it prefers the provider's own
  `marketState` field when available, which does account for holidays.
