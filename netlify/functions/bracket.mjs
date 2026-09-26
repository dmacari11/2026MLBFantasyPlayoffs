// Bracket pool: each manager picks the winner of every postseason series.
// The 12-team field comes from live MLB standings until the first Wild Card
// game starts; then picks lock and the field is frozen. Series results come
// from the MLB postseason schedule. Stored in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const MLB = "https://statsapi.mlb.com/api/v1";
const SEASON = 2026;
const MANAGERS = ["Dan", "Dio", "CK"];
const LEAGUES = { 103: "AL", 104: "NL" };
const ROUND_OF = { F: "WC", D: "DS", L: "CS", W: "WS" };
const WINS_NEEDED = { F: 2, D: 3, L: 4, W: 4 };
// Used only until MLB posts a real first-pitch time for the Wild Card round.
const FALLBACK_LOCK = "2026-09-29T16:00:00Z";
const FRESH_MS = 60_000;

// Series slots in bracket order. Each lists where its two teams come from:
// a number is a seed, a string is the slot whose winner advances.
const SLOTS = {};
for (const lg of ["AL", "NL"]) {
  SLOTS[`${lg}-WC1`] = { round: "WC", lg, from: [3, 6] };
  SLOTS[`${lg}-WC2`] = { round: "WC", lg, from: [4, 5] };
  SLOTS[`${lg}-DS1`] = { round: "DS", lg, from: [1, `${lg}-WC2`] };
  SLOTS[`${lg}-DS2`] = { round: "DS", lg, from: [2, `${lg}-WC1`] };
  SLOTS[`${lg}-CS`] = { round: "CS", lg, from: [`${lg}-DS1`, `${lg}-DS2`] };
}
SLOTS.WS = { round: "WS", lg: null, from: ["AL-CS", "NL-CS"] };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": "fantasy-mlb-playoffs" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

const pct = (t) => (t.wins + t.losses ? t.wins / (t.wins + t.losses) : 0);
const rank = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 99);

// Seeds 1-3: division winners by record. Seeds 4-6: best three wild cards.
function fieldFromStandings(st) {
  const field = { AL: [], NL: [] };
  const byLg = { AL: [], NL: [] };
  for (const rec of st.records || []) {
    const lg = LEAGUES[rec.league?.id];
    if (!lg) continue;
    for (const t of rec.teamRecords || []) {
      byLg[lg].push({
        id: t.team.id,
        abbr: t.team.abbreviation || "",
        name: t.team.teamName || t.team.clubName || t.team.name || "",
        w: t.wins, l: t.losses,
        div: rank(t.divisionRank) === 1,
        wc: rank(t.wildCardRank),
        lr: rank(t.leagueRank),
        clinched: !!t.clinched,
      });
    }
  }
  for (const lg of ["AL", "NL"]) {
    const teams = byLg[lg];
    const leaders = teams.filter((t) => t.div).sort((a, b) => pct(b) - pct(a) || a.lr - b.lr).slice(0, 3);
    const wild = teams.filter((t) => !leaders.includes(t)).sort((a, b) => a.wc - b.wc || pct(b) - pct(a) || a.lr - b.lr).slice(0, 3);
    field[lg] = [...leaders, ...wild].map((t, i) => ({
      seed: i + 1, id: t.id, abbr: t.abbr, name: t.name, w: t.w, l: t.l, clinched: t.clinched,
    }));
  }
  return field.AL.length === 6 && field.NL.length === 6 ? field : null;
}

// Every postseason series so far: who played, games won, and the winner once decided.
function seriesFromSchedule(sched) {
  const games = (sched.dates || []).flatMap((d) => d.games || []);
  const map = new Map();
  let lockAt = null, started = false;
  for (const g of games) {
    const round = ROUND_OF[g.gameType];
    if (!round) continue;
    const a = g.teams?.away?.team?.id, h = g.teams?.home?.team?.id;
    const state = g.status?.abstractGameState;
    if (state === "Live" || state === "Final") started = true;
    if (g.gameType === "F" && g.gameDate && !g.status?.startTimeTBD && !(lockAt && lockAt <= g.gameDate)) lockAt = g.gameDate;
    if (!a || !h) continue;
    const key = `${round}:${Math.min(a, h)}-${Math.max(a, h)}`;
    if (!map.has(key)) map.set(key, { round, teams: [a, h], wins: { [a]: 0, [h]: 0 }, winner: null, need: WINS_NEEDED[g.gameType] });
    const s = map.get(key);
    if (state === "Final" && !/postponed|cancel/i.test(g.status?.detailedState || "")) {
      if (g.teams.away.isWinner) s.wins[a]++;
      else if (g.teams.home.isWinner) s.wins[h]++;
    }
  }
  const series = [...map.values()].map((s) => {
    const w = s.teams.find((t) => s.wins[t] >= s.need);
    return { round: s.round, teams: s.teams, wins: s.wins, winner: w || null };
  });
  return { series, lockAt, started };
}

async function mlbData(store) {
  const cached = await store.get("bracket-mlb", { type: "json" });
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached;
  try {
    const [st, sched] = await Promise.all([
      getJSON(`${MLB}/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason&hydrate=team`),
      getJSON(`${MLB}/schedule?sportId=1&season=${SEASON}&gameType=F,D,L,W&hydrate=team`),
    ]);
    const { series, lockAt, started } = seriesFromSchedule(sched);
    const out = {
      field: fieldFromStandings(st) || cached?.field || null,
      series, lockAt: lockAt || FALLBACK_LOCK, started, fetchedAt: Date.now(),
    };
    await store.setJSON("bracket-mlb", out);
    return out;
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    return { field: null, series: [], lockAt: FALLBACK_LOCK, started: false, fetchedAt: Date.now(), error: String(err.message || err) };
  }
}

// The two teams that meet in a slot, given the field and a manager's earlier picks.
function teamsIn(slot, field, picks) {
  const s = SLOTS[slot];
  return s.from.map((f) => (typeof f === "number" ? field[s.lg]?.[f - 1]?.id ?? null : picks[f] ?? null));
}
// Drop picks that no longer fit the bracket (e.g. after an earlier pick changed).
function prune(picks, field) {
  const out = {};
  for (const slot of Object.keys(SLOTS)) {
    const v = picks[slot];
    if (v == null) continue;
    const pair = teamsIn(slot, field, out);
    if (pair.includes(v)) out[slot] = v;
  }
  return out;
}

async function readAll(store, mlb) {
  const frozen = await store.get("bracket-field", { type: "json" });
  const locked = mlb.started || Date.now() >= Date.parse(mlb.lockAt);
  let field = frozen || mlb.field;
  // Freeze the field the moment picks lock, so late standings quirks can't move it.
  if (locked && !frozen && mlb.field) { await store.setJSON("bracket-field", mlb.field); field = mlb.field; }
  const picks = {};
  for (const m of MANAGERS) picks[m] = (await store.get(`bracket-picks-${m}`, { type: "json" })) || {};
  return {
    field, picks, locked, lockAt: mlb.lockAt, series: mlb.series || [],
    fetchedAt: mlb.fetchedAt, stale: !!mlb.stale, error: mlb.error,
  };
}

export default async (req) => {
  const store = getStore({ name: "league", consistency: "strong" });
  const mlb = await mlbData(store);

  if (req.method === "GET") return json(await readAll(store, mlb));
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const pin = process.env.LEAGUE_PIN;
  if (pin && String(body.pin || "") !== String(pin)) return json({ error: "Wrong PIN" }, 401);

  const state = await readAll(store, mlb);
  if (state.locked) return json({ error: "The playoffs have started — brackets are locked." }, 400);
  if (!state.field) return json({ error: "The playoff field isn't available yet." }, 400);
  if (!MANAGERS.includes(body.manager)) return json({ error: "Unknown manager." }, 400);
  const raw = body.picks && typeof body.picks === "object" ? body.picks : {};
  const clean = {};
  for (const [slot, v] of Object.entries(raw)) if (SLOTS[slot] && Number.isInteger(v)) clean[slot] = v;
  const picks = prune(clean, state.field);
  await store.setJSON(`bracket-picks-${body.manager}`, picks);
  state.picks[body.manager] = picks;
  return json(state);
};

export const config = { path: "/api/bracket" };
