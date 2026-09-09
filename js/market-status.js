// ==============================================================================
// market-status.js — Indian market session state.
//
// Two signals are combined:
//  1. A local clock-based calculation against NSE/BSE's published regular
//     trading hours (09:15–15:30 IST, Mon–Fri) using the Asia/Kolkata
//     timezone. This does NOT know about exchange holidays.
//  2. The `marketState` field the provider returns per-instrument
//     (PRE / REGULAR / POST / POSTPOST / CLOSED), which DOES reflect
//     holidays, since it comes from the exchange via the data provider.
//
// When provider state is available it wins (it's the more authoritative,
// live signal). The clock-based calculation is the fallback shown before
// any data has loaded, and is clearly labelled as an estimate.
// ==============================================================================

const IST_TIMEZONE = 'Asia/Kolkata';

function getISTParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TIMEZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    weekday: parts.weekday, // 'Mon'..'Sun'
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

/**
 * Clock-only estimate. Does not know about exchange holidays.
 */
function estimateStatusFromClock(date = new Date()) {
  const { weekday, hour, minute } = getISTParts(date);
  const minutesNow = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  if (isWeekend) return { state: 'CLOSED', label: 'MARKET CLOSED', estimated: true };

  const PRE_OPEN = 9 * 60; // 09:00
  const OPEN = 9 * 60 + 15; // 09:15
  const CLOSE = 15 * 60 + 30; // 15:30

  if (minutesNow >= PRE_OPEN && minutesNow < OPEN) {
    return { state: 'PRE_OPEN', label: 'PRE-MARKET', estimated: true };
  }
  if (minutesNow >= OPEN && minutesNow < CLOSE) {
    return { state: 'OPEN', label: 'MARKET OPEN', estimated: true };
  }
  return { state: 'CLOSED', label: 'MARKET CLOSED', estimated: true };
}

/**
 * Combine a provider-reported marketState (if present) with the clock
 * estimate. Provider state wins when present because it reflects holidays.
 */
function resolveStatus(providerMarketState) {
  const map = {
    PRE: { state: 'PRE_OPEN', label: 'PRE-MARKET' },
    PREPRE: { state: 'PRE_OPEN', label: 'PRE-MARKET' },
    REGULAR: { state: 'OPEN', label: 'MARKET OPEN' },
    POST: { state: 'CLOSED', label: 'MARKET CLOSED' },
    POSTPOST: { state: 'CLOSED', label: 'MARKET CLOSED' },
    CLOSED: { state: 'CLOSED', label: 'MARKET CLOSED' },
  };

  if (providerMarketState && map[providerMarketState]) {
    return { ...map[providerMarketState], estimated: false };
  }
  return estimateStatusFromClock();
}

function formatISTClock(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

window.MarketStatus = { resolveStatus, estimateStatusFromClock, formatISTClock };
