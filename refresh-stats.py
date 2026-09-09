#!/usr/bin/env python3
"""Refresh the standings strip on every bet from Sleeper's public stats API.

The published page cannot reach Sleeper itself (artifacts block outside
requests), so this runs outside the page and produces the documents to write
back into the shared book:

    python refresh-stats.py --bets-dir db-export/bets --out stats-out

Input:  one JSON file per bet, as exported by the artifact's read_db action
        (`read_db … --out_dir db-export`). Bets without a `stats` block are skipped.
Output: <out>/<betId>.json  = {"stats": {...}}   -> write_db update, file_path
        <out>/refresh.json  = {"finishedAt", "through", "status"} -> update league/refresh
        <out>/roster.json   = rostered fantasy players + defenses -> set league/roster
                              (the propose-a-bet picker reads this)
        <out>/schedule.json = {"weekStarts": {"1": iso, ...}} -> update league/config
                              (first kickoff of each week; bets lock an hour before it)
        <out>/games.json    = every game with kickoff and score -> set league/games
                              (the ticker under the header scrolls the current week)

Which number a row gets comes from `stats.stat`, or is inferred from the metric text:
    pts_ppr    "PPR points"
    rec_yd     "Receiving yards"
    takeaways  "Takeaways" = interceptions + fumble recoveries (team-defense rows)
A row key of "A+B" sums the players A and B.
"""
import argparse, datetime, json, os, re, sys, urllib.request

API = "https://api.sleeper.app/v1"
LAST_WEEK = 18


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def load_bets(bets_dir):
    bets = []
    for fn in sorted(os.listdir(bets_dir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(bets_dir, fn), encoding="utf-8") as f:
            doc = json.load(f)
        data = doc.get("data") if isinstance(doc.get("data"), dict) else doc
        bid = doc.get("id") or fn[:-5]
        bets.append((bid, data))
    return bets


def stat_kind(stats):
    if stats.get("stat"):
        return stats["stat"]
    m = (stats.get("metric") or "").lower()
    if "takeaway" in m or "turnover" in m:
        return "takeaways"
    if "yard" in m:
        return "rec_yd"
    return "pts_ppr"


# stats the form offers that are sums of Sleeper fields
COMPOSITES = {
    "takeaways": ["int", "fum_rec"],
    "td_scored": ["rush_td", "rec_td"],
}
FANTASY_POS = {"QB", "RB", "WR", "TE", "K"}


def value_for(row_key, kind, totals):
    total = 0.0
    fields = COMPOSITES.get(kind, [kind])
    for key in str(row_key).split("+"):
        row = totals.get(key.strip(), {}) or {}
        for f in fields:
            total += float(row.get(f) or 0)
    return round(total, 1)


def week_starts(season):
    """First kickoff of each regular-season week, as ISO UTC.

    Source: nflverse's schedule (gameday + gametime in Eastern), converted with the
    real America/New_York zone so the November clock change is handled. Sleeper's
    schedule feed is the fallback — dates only, so 8:15 PM ET is assumed. (ESPN's
    scoreboard has times too but refuses non-browser requests.)"""
    import csv, datetime, io
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
    starts = {}
    try:
        req = urllib.request.Request("https://github.com/nflverse/nfldata/raw/master/data/games.csv",
                                     headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8")
        first = {}
        for row in csv.DictReader(io.StringIO(text)):
            if row.get("season") != str(season) or row.get("game_type") != "REG":
                continue
            if not row.get("gameday") or not row.get("gametime"):
                continue
            w = str(int(row["week"]))
            local = datetime.datetime.strptime(row["gameday"] + " " + row["gametime"], "%Y-%m-%d %H:%M").replace(tzinfo=ET)
            if w not in first or local < first[w]:
                first[w] = local
        for w, local in first.items():
            starts[w] = local.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")
    except Exception as e:
        print(f"  nflverse schedule unavailable ({e}); falling back to Sleeper dates")
    if len(starts) < LAST_WEEK:
        try:
            for g in get(f"{API}/schedule/nfl/regular/{season}"):
                w, day = str(g.get("week")), g.get("date")
                if not w or not day or w in starts:
                    continue
                # Sleeper gives the date only; assume a Thursday-night-style 8:15 PM ET start (00:15Z next day)
                d = datetime.datetime.strptime(day, "%Y-%m-%d") + datetime.timedelta(days=1)
                cand = d.strftime("%Y-%m-%dT00:15:00Z")
                if w not in starts or cand < starts[w]:
                    starts[w] = cand
        except Exception:
            pass
    return starts


def games_doc(season, now):
    """Every regular-season game with kickoff (UTC), and its state as of this run:
    pre / live / final, score, quarter, clock, possession, red zone.

    Source: Sleeper's scores feed (/scores/nfl/regular/<season>/<week>) — public and
    updated in real time during games. nflverse's schedule (scores after the fact) is
    the fallback, then Sleeper's date-only schedule feed."""
    import csv, datetime, io
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
    games = []
    try:
        for w in range(1, LAST_WEEK + 1):
            for s in get(f"{API}/scores/nfl/regular/{season}/{w}"):
                m = s.get("metadata") or {}
                iso = (m.get("date_time") or "").replace("+00:00", "Z")
                if not iso:
                    continue
                g = {"id": s.get("game_id"), "week": int(s.get("week") or w),
                     "away": m.get("away_team") or s.get("away"), "home": m.get("home_team") or s.get("home"),
                     "date": iso[:19] + "Z" if len(iso) >= 19 else iso}
                over = bool(m.get("is_over")) or s.get("status") == "complete"
                live = (not over) and (bool(m.get("is_in_progress")) or bool(m.get("has_started")) or s.get("status") == "in_game")
                g["status"] = "final" if over else ("live" if live else "pre")
                if m.get("home_score") is not None and m.get("away_score") is not None:
                    g["awayScore"] = int(m["away_score"]); g["homeScore"] = int(m["home_score"])
                if live or over:
                    q = m.get("quarter_num"); g["q"] = int(q) if str(q).strip().isdigit() else None
                    g["ql"] = m.get("quarter") or ""            # "1".."4", "OT", "F"
                    g["clock"] = m.get("time_remaining") or ""
                    g["ot"] = bool(m.get("is_overtime"))
                if live:
                    g["pos"] = m.get("possession") or ""
                    g["rz"] = bool(m.get("red_zone"))
                    g["dd"] = m.get("down_and_distance") or ""
                games.append(g)
        if not games:
            raise RuntimeError("scores feed returned nothing")
        games.sort(key=lambda g: (g["week"], g["date"]))
        return {"season": str(season), "updatedAt": now, "count": len(games), "source": "Sleeper scores", "games": games}
    except Exception as e:
        print(f"  Sleeper scores feed unavailable ({e}); falling back to nflverse")
    try:
        req = urllib.request.Request("https://github.com/nflverse/nfldata/raw/master/data/games.csv",
                                     headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8")
        for row in csv.DictReader(io.StringIO(text)):
            if row.get("season") != str(season) or row.get("game_type") != "REG":
                continue
            if not row.get("gameday") or not row.get("gametime"):
                continue
            local = datetime.datetime.strptime(row["gameday"] + " " + row["gametime"], "%Y-%m-%d %H:%M").replace(tzinfo=ET)
            g = {"id": row.get("game_id"), "week": int(row["week"]), "away": row["away_team"], "home": row["home_team"],
                 "date": local.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")}
            if row.get("away_score") not in (None, "") and row.get("home_score") not in (None, ""):
                g["awayScore"] = int(float(row["away_score"])); g["homeScore"] = int(float(row["home_score"]))
            games.append(g)
    except Exception as e:
        print(f"  nflverse games unavailable ({e}); falling back to Sleeper dates")
        try:
            for s in get(f"{API}/schedule/nfl/regular/{season}"):
                d = datetime.datetime.strptime(s["date"], "%Y-%m-%d") + datetime.timedelta(days=1)
                games.append({"id": s.get("game_id"), "week": int(s["week"]), "away": s["away"], "home": s["home"],
                              "date": d.strftime("%Y-%m-%dT00:15:00Z"), "status": s.get("status")})
        except Exception:
            pass
    games.sort(key=lambda g: (g["week"], g["date"]))
    return {"season": str(season), "updatedAt": now, "count": len(games), "games": games}


def roster_doc(players, now):
    """Trimmed roster for the page's picker: rostered fantasy players + the 32 defenses."""
    rows = []
    for pid, v in players.items():
        v = v or {}
        if v.get("position") == "DEF":
            rows.append([pid, f"{v.get('first_name','')} {v.get('last_name','')}".strip(), "DEF", pid])
        elif v.get("team") and set(v.get("fantasy_positions") or []) & FANTASY_POS:
            rows.append([pid, v.get("full_name") or "", v.get("position") or "", v.get("team")])
    rows.sort(key=lambda r: (r[2] == "DEF", r[1]))
    return {"updatedAt": now, "count": len(rows), "players": rows}


def through_week(season):
    """Highest week with any stats posted; 0 before the season starts."""
    last = 0
    for w in range(1, LAST_WEEK + 1):
        try:
            if get(f"{API}/stats/nfl/regular/{season}/{w}"):
                last = w
            else:
                break
        except Exception:
            break
    return last


def find(query):
    """Look up Sleeper IDs for a bet row: `--find "ladd mcconkey"`, `--find texans`, `--find HOU`."""
    q = query.strip().lower()
    players = get(f"{API}/players/nfl")
    hits = []
    for pid, v in players.items():
        v = v or {}
        name = (v.get("full_name") or v.get("team") or "").lower()
        if v.get("position") == "DEF":
            # team defenses are keyed by abbreviation; match code or nickname-ish
            if q in pid.lower() or q in (v.get("last_name") or "").lower() or q in (v.get("first_name") or "").lower():
                hits.append((pid, f"{v.get('first_name','')} {v.get('last_name','')}".strip(), "DEF", pid))
        elif q in name or q in (v.get("search_full_name") or ""):
            hits.append((pid, v.get("full_name"), v.get("position"), v.get("team") or "FA"))
    hits.sort(key=lambda h: (h[3] == "FA", h[1] or ""))
    if not hits:
        print(f"no match for {query!r}")
        return 1
    print(f"{'id':<8} {'name':<28} {'pos':<4} team")
    for pid, name, pos, team in hits[:25]:
        print(f"{pid:<8} {name:<28} {pos:<4} {team}")
    if len(hits) > 25:
        print(f"... {len(hits) - 25} more; narrow the query")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bets-dir")
    ap.add_argument("--out", default="stats-out")
    ap.add_argument("--season", default="2026")
    ap.add_argument("--find", help="look up Sleeper IDs by player name or team")
    a = ap.parse_args()

    if a.find:
        return find(a.find)
    if not a.bets_dir:
        ap.error("--bets-dir is required unless using --find")

    os.makedirs(a.out, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    week = through_week(a.season)
    totals = get(f"{API}/stats/nfl/regular/{a.season}") or {}
    players = get(f"{API}/players/nfl") or {}
    through = f"Through week {week}" if week else "No games played yet"
    print(f"season {a.season}: {through}; {len(totals)} stat lines")

    def team_for(row_key):
        """Current team(s) for a row's player key(s); None for team-defense rows."""
        codes = []
        for key in str(row_key).split("+"):
            v = players.get(key.strip()) or {}
            if v.get("position") == "DEF":
                return None
            codes.append(v.get("team") or "FA")
        return " · ".join(codes) if codes else None

    written = 0
    for bid, b in load_bets(a.bets_dir):
        S = b.get("stats")
        if not isinstance(S, dict) or not isinstance(S.get("rows"), list):
            continue
        kind = stat_kind(S)
        # one or many tracked stats; `kind` (the first) also feeds the legacy `value`
        tracks = S.get("tracks") if isinstance(S.get("tracks"), list) and S.get("tracks") else [{"stat": kind}]
        rows = []
        for r in S["rows"]:
            r = dict(r)
            r["values"] = {t["stat"]: value_for(r.get("key", ""), t["stat"], totals) for t in tracks if t.get("stat")}
            r["value"] = value_for(r.get("key", ""), kind, totals)
            team = team_for(r.get("key", ""))
            if team:
                r["team"] = team
                # drop a hand-typed "(LAC)" so the team shows once, from Sleeper
                r["label"] = re.sub(r"\s*\([A-Z]{2,3}\)", "", r.get("label") or "").strip()
            rows.append(r)
        out = dict(S)
        out.update({"stat": kind, "rows": rows, "through": through,
                    "source": "Sleeper", "updatedAt": now})
        with open(os.path.join(a.out, f"{bid}.json"), "w", encoding="utf-8") as f:
            json.dump({"stats": out}, f, indent=2)
        written += 1
        shown = "+".join(t["stat"] for t in tracks) if len(tracks) > 1 else kind
        print(f"  {bid:<22} {shown:<14} " + "  ".join(
            f"{r.get('label')}{' ['+r['team']+']' if r.get('team') else ''}="
            + (str(r["value"]) if len(tracks) == 1 else "/".join(str(v) for v in r["values"].values()))
            for r in rows))

    with open(os.path.join(a.out, "refresh.json"), "w", encoding="utf-8") as f:
        json.dump({"finishedAt": now, "through": through, "status": "done"}, f, indent=2)
    roster = roster_doc(players, now)
    with open(os.path.join(a.out, "roster.json"), "w", encoding="utf-8") as f:
        json.dump(roster, f, separators=(",", ":"))
    starts = week_starts(a.season)
    with open(os.path.join(a.out, "schedule.json"), "w", encoding="utf-8") as f:
        json.dump({"weekStarts": starts, "scheduleUpdatedAt": now}, f, indent=1)
    games = games_doc(a.season, now)
    with open(os.path.join(a.out, "games.json"), "w", encoding="utf-8") as f:
        json.dump(games, f, separators=(",", ":"))
    print(f"wrote {written} bet file(s), refresh.json, roster.json ({roster['count']} entries), "
          f"schedule.json ({len(starts)} weeks) and games.json ({games['count']} games) to {a.out}/")

    # One bundle the page can import directly (Import refresh button) — no Claude needed.
    bundle = {"version": 1, "madeAt": now, "bets": {}, "refresh": {"finishedAt": now, "through": through, "status": "done"},
              "roster": roster, "games": games, "config": {"weekStarts": starts, "scheduleUpdatedAt": now}}
    for fn in os.listdir(a.out):
        if fn.endswith(".json") and fn not in ("refresh.json", "roster.json", "games.json", "schedule.json", "bundle.json"):
            with open(os.path.join(a.out, fn), encoding="utf-8") as f:
                bundle["bets"][fn[:-5]] = json.load(f)
    text = json.dumps(bundle, separators=(",", ":"))
    with open(os.path.join(a.out, "bundle.json"), "w", encoding="utf-8") as f:
        f.write(text)
    copied = False
    try:
        import subprocess
        if sys.platform == "win32":
            subprocess.run("clip", input=text.encode("utf-16le"), check=True)
            copied = True
        elif sys.platform == "darwin":
            subprocess.run("pbcopy", input=text.encode("utf-8"), check=True)
            copied = True
    except Exception:
        pass
    print(f"bundle.json: {len(text)//1024} KB" + (" — copied to clipboard. Open the page, Import refresh, paste." if copied else f" at {a.out}/bundle.json — paste its contents into Import refresh."))
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
