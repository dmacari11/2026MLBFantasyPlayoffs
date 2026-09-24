// Live stats: pulls postseason box scores from MLB's public Stats API and
// returns one line per drafted player per game. Cached ~45s in Netlify Blobs;
// finished games are cached permanently.
import { getStore } from "@netlify/blobs";

const MLB = "https://statsapi.mlb.com/api/v1";
const ROUND_OF = { F: "WC", D: "DS", L: "CS", W: "WS" };
const SEASON_START = "2026-09-28";
const FRESH_MS = 45_000;

const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const toOuts = (ip) => {
  const [w, f] = String(ip ?? "0").split(".");
  return (parseInt(w, 10) || 0) * 3 + (parseInt(f, 10) || 0);
};
const n = (v) => (Number.isFinite(+v) ? +v : 0);
const label = (date, opp, home) => {
  const d = new Date(date + "T12:00:00Z");
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${md} ${home ? "vs" : "@"} ${opp}`;
};

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": "fantasy-mlb-playoffs" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export default async () => {
  const store = getStore({ name: "league", consistency: "strong" });
  const cached = await store.get("stats", { type: "json" });
  const state = (await store.get("state", { type: "json" })) || { picks: [] };
  const picks = (state.picks || []).filter((p) => Number.isInteger(p.mlbId));
  // Re-pull whenever the drafted players change, otherwise at most every FRESH_MS.
  const sig = picks.map((p) => `${p.id}:${p.mlbId}:${p.slot}`).join("|");
  if (cached && cached.sig === sig && Date.now() - cached.fetchedAt < FRESH_MS) return json(cached);
  if (!picks.length) {
    const out = { lines: [], fetchedAt: Date.now(), sig };
    await store.setJSON("stats", out);
    return json(out);
  }

  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const sched = await getJSON(
      `${MLB}/schedule?sportId=1&gameType=F,D,L,W&startDate=${SEASON_START}&endDate=${today}&hydrate=team`
    );
    const games = (sched.dates || []).flatMap((d) => d.games || []);
    const lines = [];

    for (const g of games) {
      const round = ROUND_OF[g.gameType];
      const state = g.status?.abstractGameState; // Preview | Live | Final
      if (!round || (state !== "Live" && state !== "Final")) continue;
      const roundPicks = picks.filter((p) => p.round === round);
      if (!roundPicks.length) continue;
      const final = state === "Final";

      let box = final ? await store.get(`box-${g.gamePk}`, { type: "json" }) : null;
      if (!box) {
        box = await getJSON(`${MLB}/game/${g.gamePk}/boxscore`);
        if (final) await store.setJSON(`box-${g.gamePk}`, box);
      }

      const abbr = { home: g.teams.home.team.abbreviation, away: g.teams.away.team.abbreviation };
      for (const p of roundPicks) {
        let side = null, pl = null;
        for (const s of ["home", "away"]) {
          const hit = box.teams?.[s]?.players?.[`ID${p.mlbId}`];
          if (hit) { side = s; pl = hit; break; }
        }
        if (!pl) continue;
        const opp = abbr[side === "home" ? "away" : "home"];
        const base = {
          id: `${g.gamePk}-${p.key}`, round, key: p.key, name: p.name, src: "auto",
          gamePk: g.gamePk, date: g.officialDate, game: label(g.officialDate, opp, side === "home"), final,
        };
        if (p.slot === "H") {
          const b = pl.stats?.batting;
          if (!b || !(n(b.plateAppearances) || n(b.atBats) || n(b.baseOnBalls) || n(b.hitByPitch) || n(b.runs))) continue;
          lines.push({ ...base, ab: n(b.atBats), h: n(b.hits), d: n(b.doubles), t: n(b.triples), hr: n(b.homeRuns),
            r: n(b.runs), rbi: n(b.rbi), sb: n(b.stolenBases), bb: n(b.baseOnBalls), hbp: n(b.hitByPitch), sf: n(b.sacFlies) });
        } else {
          const q = pl.stats?.pitching;
          if (!q || !(n(q.battersFaced) || n(q.numberOfPitches) || toOuts(q.inningsPitched))) continue;
          lines.push({ ...base, outs: q.outs != null ? n(q.outs) : toOuts(q.inningsPitched), h: n(q.hits), er: n(q.earnedRuns),
            bb: n(q.baseOnBalls), k: n(q.strikeOuts), w: n(q.wins), sv: n(q.saves), hld: n(q.holds) });
        }
      }
    }

    const out = { lines, fetchedAt: Date.now(), sig };
    await store.setJSON("stats", out);
    return json(out);
  } catch (err) {
    // MLB hiccup: serve the last good copy rather than nothing.
    if (cached) return json({ ...cached, stale: true });
    return json({ lines: [], fetchedAt: Date.now(), error: String(err.message || err) });
  }
};

export const config = { path: "/api/stats" };
