// 2026 regular-season stats for one team's roster, for the draft room's player table.
// GET /api/playerstats?team=SEA&ids=1,2,3  (ids = MLB player ids from rosters.json)
// Full-season totals across every team a player played for. Cached 6 h per team in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const MLB = "https://statsapi.mlb.com/api/v1";
const SEASON = 2026;
const FRESH_MS = 6 * 3600_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const n = (v) => (Number.isFinite(+v) ? +v : 0);
const toOuts = (ip) => {
  const [w, f] = String(ip ?? "0").split(".");
  return (parseInt(w, 10) || 0) * 3 + (parseInt(f, 10) || 0);
};

// A traded player can have one split per team plus a combined one; use the combined
// split when present, otherwise add the team splits together.
function splitsFor(person, group) {
  const g = (person.stats || []).find((s) => s.group?.displayName === group);
  const splits = (g?.splits || []).filter((s) => !s.season || String(s.season) === String(SEASON));
  if (!splits.length) return null;
  const whole = splits.find((s) => !s.team);
  return whole ? [whole] : splits.filter((s) => s.team);
}

function hitting(person) {
  const sp = splitsFor(person, "hitting");
  if (!sp) return null;
  const t = { g: 0, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0, r: 0, hr: 0, rbi: 0, sb: 0 };
  for (const { stat: s = {} } of sp) {
    t.g += n(s.gamesPlayed); t.ab += n(s.atBats); t.h += n(s.hits); t.bb += n(s.baseOnBalls);
    t.hbp += n(s.hitByPitch); t.sf += n(s.sacFlies); t.tb += n(s.totalBases); t.r += n(s.runs);
    t.hr += n(s.homeRuns); t.rbi += n(s.rbi); t.sb += n(s.stolenBases);
  }
  if (!t.g && !t.ab) return null;
  const pa = t.ab + t.bb + t.hbp + t.sf;
  const ops = pa ? (t.h + t.bb + t.hbp) / pa + (t.ab ? t.tb / t.ab : 0) : null;
  return { g: t.g, ab: t.ab, r: t.r, hr: t.hr, rbi: t.rbi, sb: t.sb, avg: t.ab ? t.h / t.ab : null, ops };
}

function pitching(person) {
  const sp = splitsFor(person, "pitching");
  if (!sp) return null;
  const t = { g: 0, gs: 0, outs: 0, er: 0, h: 0, bb: 0, k: 0, w: 0, sv: 0, hld: 0 };
  for (const { stat: s = {} } of sp) {
    t.g += n(s.gamesPlayed || s.gamesPitched); t.gs += n(s.gamesStarted);
    t.outs += s.outs != null ? n(s.outs) : toOuts(s.inningsPitched);
    t.er += n(s.earnedRuns); t.h += n(s.hits); t.bb += n(s.baseOnBalls); t.k += n(s.strikeOuts);
    t.w += n(s.wins); t.sv += n(s.saves); t.hld += n(s.holds);
  }
  if (!t.g && !t.outs) return null;
  return {
    g: t.g, gs: t.gs, outs: t.outs, w: t.w, k: t.k, svh: t.sv + t.hld,
    era: t.outs ? (t.er * 27) / t.outs : null, whip: t.outs ? ((t.bb + t.h) * 3) / t.outs : null,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const team = String(url.searchParams.get("team") || "").toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(team)) return json({ error: "Bad team." }, 400);
  const ids = [...new Set(String(url.searchParams.get("ids") || "").split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 90);
  if (!ids.length) return json({ hit: {}, pit: {}, fetchedAt: Date.now() });
  const sig = ids.slice().sort((a, b) => a - b).join(",");

  const store = getStore({ name: "league", consistency: "strong" });
  const key = `pstats-${team}`;
  const cached = await store.get(key, { type: "json" });
  if (cached && cached.sig === sig && Date.now() - cached.fetchedAt < FRESH_MS) return json(cached);

  try {
    const r = await fetch(
      `${MLB}/people?personIds=${ids.join(",")}&hydrate=stats(group=[hitting,pitching],type=[season],season=${SEASON},sportId=1)`,
      { headers: { "user-agent": "fantasy-mlb-playoffs" } }
    );
    if (!r.ok) throw new Error(`MLB ${r.status}`);
    const data = await r.json();
    const out = { hit: {}, pit: {}, sig, fetchedAt: Date.now() };
    for (const p of data.people || []) {
      const h = hitting(p), q = pitching(p);
      if (h) out.hit[p.id] = h;
      if (q) out.pit[p.id] = q;
    }
    await store.setJSON(key, out);
    return json(out);
  } catch (err) {
    if (cached) return json({ ...cached, stale: true });
    return json({ hit: {}, pit: {}, fetchedAt: Date.now(), error: String(err.message || err) });
  }
};

export const config = { path: "/api/playerstats" };
