// Today's MLB games (Eastern time) with live scores, for the scoreboard strip under the site title.
// GET /api/scoreboard. Cached ~20 s in Netlify Blobs so every visitor shares one MLB request.
import { getStore } from "@netlify/blobs";

const MLB = "https://statsapi.mlb.com/api/v1";
const FRESH_MS = 20_000;

const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const side = (t) => ({
  id: t?.team?.id ?? null,
  abbr: t?.team?.abbreviation || "",
  score: Number.isFinite(t?.score) ? t.score : null,
  win: !!t?.isWinner,
});

export default async () => {
  const store = getStore({ name: "league", consistency: "strong" });
  // After 4 a.m. ET show today's slate; before that keep showing last night's games.
  const now = new Date(Date.now() - 4 * 3600_000);
  const date = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const cached = await store.get("scoreboard", { type: "json" });
  if (cached && cached.date === date && Date.now() - cached.fetchedAt < FRESH_MS) return json(cached);

  try {
    const r = await fetch(`${MLB}/schedule?sportId=1&date=${date}&hydrate=team,linescore`, {
      headers: { "user-agent": "fantasy-mlb-playoffs" },
    });
    if (!r.ok) throw new Error(`MLB ${r.status}`);
    const sched = await r.json();
    const games = (sched.dates || []).flatMap((d) => d.games || []).map((g) => {
      const ls = g.linescore || {};
      return {
        pk: g.gamePk,
        type: g.gameType,
        state: g.status?.abstractGameState || "Preview", // Preview | Live | Final
        detail: g.status?.detailedState || "",
        tbd: !!g.status?.startTimeTBD,
        start: g.gameDate,
        inning: ls.currentInning || null,
        half: ls.inningState || ls.inningHalf || "", // Top | Middle | Bottom | End
        outs: Number.isFinite(ls.outs) ? ls.outs : null,
        away: side(g.teams?.away),
        home: side(g.teams?.home),
      };
    });
    games.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.pk - b.pk);
    const out = { date, games, fetchedAt: Date.now() };
    await store.setJSON("scoreboard", out);
    return json(out);
  } catch (err) {
    if (cached) return json({ ...cached, stale: true });
    return json({ date, games: [], fetchedAt: Date.now(), error: String(err.message || err) });
  }
};

export const config = { path: "/api/scoreboard" };
