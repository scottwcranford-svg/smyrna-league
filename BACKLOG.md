# Backlog

Ideas talked through and parked. Nothing here is built. Each entry says what was decided,
what is still open, and roughly what it costs, so it can be picked up cold.

## Playoff odds on league-result tickets

**What:** a calculated likelihood beside the record and place on every league-result
ticket: makes the playoffs, finishes 1st / top 3 / last, wins the championship. Today the
ticket shows the standing (`leaguelineHtml` in `render.js`) and nothing about the chance.

**How:** rate every team from points scored so far blended with Sleeper's projected starter
points (projection-heavy early, actuals by mid-season); for each remaining pairing in
`league/standings.pairings` price A over B from the rating gap (weekly fantasy scores swing
about 20–25 points, so +10 is roughly 62%, +20 roughly 74%), plus the league-average match
against the median team; play the rest of the season out a few thousand times with Sleeper's
tiebreak (record, then points for) and count the finishes. The bracket simulated the same
way gives champion. Cache the result per refresh, not per draw (see the derived-doc loop
hazard in the README).

**Can't see:** trades, waivers, a Sunday injury, a manager who stops setting lineups. Say so
on the ticket. It is a reference number, not a settlement input.

**Cost:** about a day. The simulation, a cached `league/odds` doc written from the refresh
loop, and one line on the standing block.

## A pool format for league-result questions

**What:** a second way of wagering on the questions that already exist, not a new scope.
Everyone pays the same share price, set by the proposer; the winning side splits the whole
pot. 5 on Yes and 2 on No at $10 is $70; Yes winners get $14 each, No winners $35 each.
Odds are the split of money, settled at the lock. Same `autoResult`, same lock, same
against-your-own-team rule (you can be in the pool on your own side only).

**Decided in discussion, not yet approved:**

- Season pools should close fast, a few days after opening or at the next kickoff, so late
  joiners don't hold a week of extra information. 2026 season pools would inherit the
  September 24 cutoff. Weekly matchup pools already lock at the first kickoff.
- Show the split and the payout each side would get live on the ticket.
- All shares on one side at the lock: refund.

**Open:**

- One share per manager, or several.
- Whether early shares weigh more. One rule drawn up: weight by join order on your side,
  1.0 then 0.1 less each, floor 0.5; payout = pot × weight ÷ side's total weight. It moves
  money from late joiners to early ones on the same side and never changes what a side wins
  as a whole. Two consequences to decide on: a late joiner on the crowded side can win and
  still get back less than the stake ($8.89 on $10 as 6th of 6), and "order on your side" is
  not "time joined" (first No on day six still weighs 1.0). A floor of stake-back on a win,
  or weighting by day joined, are the fixes.

**Cost:** a weekend. A `pool` kind with a share price and a list of entrants per side, a
join button in place of the seat, a payout table on the ticket, and the ledger summing
pools into the season tally.

**Mockups:** https://claude.ai/artifact/WChLQfRMAC95WwJBDP9Qaj (row two: the pool ticket,
the join sheet, flat against weighted payouts).

## A market format (Kalshi-style), further off

**What:** the same questions traded at a floating price. Contracts pay $1 or $0, the price
is the league's odds, anyone buys either side in any size, a holder can sell back before the
result. With twelve people an order book is too thin; it would need an automated market
maker that opens at a price and moves a fixed step per contract, funded by a small subsidy
per question whose worst case is fixed up front.

**Why parked:** it is a position ledger (quantity and average price per manager per
question), a buy/sell sheet, and a decision on who funds the subsidy. The playoff odds above
would be the opening price instead of 50¢. Prices reflect where the money goes, not
likelihood; at league size, sentiment dominates.

**Mockups:** same canvas, row one: today's bet, the market ticket, the buy sheet, and where
Bet / Market would sit in the form.

## After the 2026 season

- Delete `LEAGUE_LOCK_WEEK["2026"]` in `clock.js`. It holds season league-result bets open
  until week 3's first kickoff for 2026 only; from 2027 they lock at the opener.
