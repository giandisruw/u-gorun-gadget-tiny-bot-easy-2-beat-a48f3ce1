// Dip Catcher v2 — MACD trend + CCI dip entry, tight risk control.
//
// Idea: the dev window (and any falling market) punishes holding. So this bot
// only buys a dip when the medium trend still points up (MACD above its
// signal line) and the short-term tape is oversold (CCI(14) at or under -48),
// then gets out fast. Long only, no leverage, no network, no secrets — the
// entry reads only the hourly bars the harness replays.
//
// v2 changes (from the v1 grade: +$57.89, 30 trades, 66.7% win rate —
// winners were cut at +1% while losers ran to the -3% stop, and the same
// symbols stopped out repeatedly in the down-drift):
//   - Let winners run: profit target raised to +2%, with a trailing stop
//     that exits once a position gives back 1% from its peak after first
//     reaching +1% — a winner that stalls keeps ~+1%, one that runs keeps
//     climbing toward +2%.
//   - Cooldown: after a stop-loss exit, the symbol is not re-entered for
//     12 bars, so a steady down-drift cannot stop the bot out again and
//     again on the same symbol.
//
// Indicators (standard TA-Lib definitions, float64, deterministic):
//   MACD(12, 26, 9): EMA(12) - EMA(26) of closes, signal = EMA(9) of MACD.
//   CCI(14): (typical - mean) / (0.015 * mean absolute deviation), typical = (h+l+c)/3.
// Entry (on a bar's close, filled at the next open):
//   MACD > signal AND CCI <= -48, on a symbol not already held and not in
//   cooldown.
// Exit (the whole position, re-checked every bar while the reason holds):
//   - value >= 102% of cost (take the +2%), or
//   - value <= 99% of the position's peak value once the peak reached
//     101% of cost (trailing stop), or
//   - value <= 97% of cost (stop, -3%), or
//   - MACD < signal AND CCI >= +100 (trend turned against the dip), or
//   - 24 bars held without taking profit (time stop: free the slot).
// Sizing: equity / 7 per slot (one slot per universe symbol), capped at the
// 25% max-weight cap and by cash; sells first, then buys, at most the order
// cap per reply; slippage capped at 100 bps so a sell into a gap is refused
// and retried rather than filled for almost nothing.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 12;
const SLOW_BARS = 26;
const SIGNAL_BARS = 9;
const CCI_BARS = 14;
const CCI_SCALE = 0.015;
/** Enter on a dip at or under this CCI. */
const CCI_ENTRY_AT_MOST = -48;
/** Reversal exit at or over this CCI while MACD is under its signal. */
const CCI_EXIT_AT_LEAST = 100;
/** Take profit: worth 102/100 of cost. */
const ROI = [102n, 100n] as const;
/** Trailing stop arms once the peak is worth this of cost. */
const TRAIL_ARM = [101n, 100n] as const;
/** Trailing stop: exit at or under this of the peak value. */
const TRAIL = [99n, 100n] as const;
/** Stop loss: worth 97/100 of cost. */
const STOP = [97n, 100n] as const;
/** Time stop: exit after this many bars held without a profit. */
const MAX_HOLD_BARS = 24;
/** Cooldown after a stop-loss exit: no re-entry for this many bars. */
const COOLDOWN_BARS = 12;
const MAX_SLIPPAGE_BPS = 100;

interface Series {
  /** The first SLOW_BARS closes, until the EMAs start. */
  warm: number[];
  fast: number | null;
  slow: number | null;
  /** The first SIGNAL_BARS MACD values, until the signal line starts. */
  macds: number[];
  signal: number | null;
  /** The last CCI_BARS typical prices, oldest first. */
  typical: number[];
}

type Signal = 'up' | 'down' | null;

const series = new Map<string, Series>();
/** The batch seq at which each position's buy filled. */
const opened = new Map<string, number>();
/** Each position's peak value (quote units) since it opened. */
const peaks = new Map<string, bigint>();
/** The batch seq until which a symbol stays in cooldown after a stop. */
const cooldownUntil = new Map<string, number>();

const mean = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const ema = (last: number, x: number, bars: number) => (x - last) * (2 / (bars + 1)) + last;

/** Fold a bar into its symbol's indicators; the signal they give on its close. */
function push(bar: Bar): Signal {
  let s = series.get(bar.symbol);
  if (s === undefined) series.set(bar.symbol, (s = { warm: [], fast: null, slow: null, macds: [], signal: null, typical: [] }));
  const c = Number(bar.c);
  if (s.slow === null || s.fast === null) {
    s.warm.push(c);
    if (s.warm.length === SLOW_BARS) {
      s.slow = mean(s.warm);
      s.fast = mean(s.warm.slice(SLOW_BARS - FAST_BARS));
    }
  } else {
    s.fast = ema(s.fast, c, FAST_BARS);
    s.slow = ema(s.slow, c, SLOW_BARS);
  }
  let macd: number | null = null;
  if (s.slow !== null && s.fast !== null) {
    macd = s.fast - s.slow;
    if (s.signal !== null) s.signal = ema(s.signal, macd, SIGNAL_BARS);
    else {
      s.macds.push(macd);
      if (s.macds.length === SIGNAL_BARS) s.signal = mean(s.macds);
    }
  }
  const typical = (Number(bar.h) + Number(bar.l) + c) / 3;
  s.typical.push(typical);
  if (s.typical.length > CCI_BARS) s.typical.shift();

  if (macd === null || s.signal === null || bar.v === '0') return null;
  const m = mean(s.typical);
  const spread = s.typical.reduce((a, x) => a + (x < m ? m - x : x - m), 0);
  const dev = typical - m;
  const cci = dev === 0 || spread === 0 ? 0 : dev / (CCI_SCALE * (spread / CCI_BARS));
  if (macd > s.signal && cci <= CCI_ENTRY_AT_MOST) return 'up';
  if (macd < s.signal && cci >= CCI_EXIT_AT_LEAST) return 'down';
  return null;
}

/** Whether a held position exits on this batch, and why. */
function exitReason(state: BarsState, seq: number, symbol: string, held: { qty: bigint; cost: bigint }, signal: Signal): 'reversal' | 'profit' | 'trail' | 'stop' | 'time' | null {
  if (signal === 'down') return 'reversal';
  const value = state.value(symbol, held.qty);
  const peak = peaks.get(symbol);
  if (peak !== undefined && value > peak) peaks.set(symbol, value);
  const best = peaks.get(symbol)!;
  if (value * ROI[1] >= held.cost * ROI[0]) return 'profit';
  if (best * TRAIL_ARM[1] >= held.cost * TRAIL_ARM[0] && value * TRAIL[1] <= best * TRAIL[0]) return 'trail';
  if (value * STOP[1] <= held.cost * STOP[0]) return 'stop';
  const openedSeq = opened.get(symbol);
  if (openedSeq !== undefined && seq - openedSeq >= MAX_HOLD_BARS) return 'time';
  return null;
}

await runBars({
  onBatch(state, batch) {
    for (const f of batch.fills) {
      if (f.side === 'buy' && f.status === 'filled') {
        opened.set(f.symbol, batch.seq);
        peaks.set(f.symbol, state.value(f.symbol, state.positions.get(f.symbol)?.qty ?? 0n));
      }
      if (f.side === 'sell' && f.status === 'filled') {
        opened.delete(f.symbol);
        peaks.delete(f.symbol);
      }
    }
    const signals = new Map<string, Signal>();
    for (const bar of batch.bars) signals.set(bar.symbol, push(bar));
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!signals.has(symbol)) continue;
      const signal = signals.get(symbol)!;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        const reason = exitReason(state, batch.seq, symbol, held, signal);
        if (reason !== null) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          if (reason === 'stop') cooldownUntil.set(symbol, batch.seq + COOLDOWN_BARS);
        }
      } else if (signal === 'up' && (cooldownUntil.get(symbol) ?? -1) <= batch.seq) {
        entries.push(symbol);
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
