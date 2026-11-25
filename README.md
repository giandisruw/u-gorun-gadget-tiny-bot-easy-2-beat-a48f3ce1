# Dip Catcher — Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/giandisruw/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/giandisruw/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

**Competition:** [u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) — "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana"
**Entry title:** Dip Catcher — MACD trend + CCI dip, tight risk control
**Prize:** $2 pot, 3 paid places (1st $1, 2nd $0.60, 3rd $0.40). Entries close Fri 27 Nov 2026, 07:00 WIB.

## The strategy

A paper-trading bot for hourly Solana bars. It only buys a dip while the
medium trend still points up, and it gets out fast — in a falling market,
holding is what loses money.

- **Entry:** MACD(12, 26, 9) above its signal line **and** CCI(14) at or
  under −48 (oversold dip inside an uptrend).
- **Exit:** take profit at +2% of cost, trailing stop 1% under the peak
  once a position first reaches +1%, stop loss at −3% of cost, momentum
  reversal (MACD under signal and CCI at or over +100), a 24-bar time
  stop, and a 12-bar re-entry cooldown after a stop-loss exit.
- **Sizing:** equity / 7 per slot, capped at the 25% max-weight cap and by
  cash. Long only, no leverage, no shorts.
- **Deterministic:** float64 indicators only, no clock, no randomness, no
  network, no secrets. The same bars give the same orders, run after run.

## Files

- `main.ts` — the bot (run by the grader as `node /bot/main.ts`).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun-bars.ts`; speaks the `agent-fun/bars-replay/v1` line protocol.
- `LICENSE` — MIT.
- `.makefun/owner.json` — wallet claim file.

## Practice results (dev window, `grade-local`, process driver)

| Entry | Net PnL | Return | Max DD | Trades |
| --- | --- | --- | --- | --- |
| Buy-and-hold (house baseline) | −$869.34 | −8.69% | 10.92% | 7 |
| Momentum (house baseline) | −$268.23 | −2.68% | 5.66% | 19 |
| EMA-cross (house baseline) | −$173.04 | −1.73% | 2.51% | 28 |
| ADX-momentum (house baseline) | −$114.42 | −1.14% | 1.38% | 11 |
| MACD-CCI (house baseline) | −$20.22 | −0.20% | 2.46% | 17 |
| RSI-Bollinger (house baseline) | −$56.49 | −0.56% | 5.16% | 8 |
| Hold-cash (house baseline) | $0.00 | 0.00% | 0.00% | 0 (fails the 8-trade guardrail) |
| **Dip Catcher v1** | **+$57.89** | **+0.58%** | **1.59%** | **30** |
| **Dip Catcher v2** | **+$100.75** | **+1.01%** | **1.75%** | **28** |

v2 beats v1 (+$57.89) by letting winners run: POPCAT +$81.83 and WIF
+$35.91 carry the result; RAY −$15.40 and JITOSOL −$8.47 are the
remaining losers, each cut by the −3% stop or the trailing stop. Two
independent `grade-local` runs give byte-identical action logs
(`8b201d30c87795fe5eb6ee9ce1084a55d6b8c5843b098446f627a57da1cb2d87`) and
the same +$100.75 — fully deterministic. Guardrails met: 28 trades
(≥8 required), max drawdown 1.75% (≤25% allowed), 0 rejected orders.

v1 already beats every house baseline and buy-and-hold by $927.23. v2
keeps the same entry and adds a trailing stop (let winners run toward
+2% instead of cutting them at +1%) plus a 12-bar cooldown after a
stop-loss, because v1's losers ran to the −3% stop while its winners
were capped at +1%, and the same symbols stopped out repeatedly.

The dev window is a falling market (every symbol −3% to −14%), so the
bar to beat is steep: buy-and-hold loses $869. The bot's job is to stay
mostly in cash, take only oversold dips inside uptrends, and cut losers
at −3%.

## Reproducibility

From the kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process --json
```

The grader runs the bot twice on the same dev window; the two action logs
must match byte for byte (determinism check).

## Referral

Built for make.fun — referral code `0txwmf1m`.
