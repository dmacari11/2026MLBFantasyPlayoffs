// League state: draft picks + draft order. Stored in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const MANAGERS = ["Dan", "Dio", "CK"];
const ROUNDS = ["WC", "DS", "CS", "WS"];
const SLOTS = { H: 3, SP: 2, RP: 1 };
const PER_ROUND = 18;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function readState(store) {
  const s = await store.get("state", { type: "json" });
  return s && Array.isArray(s.picks) ? s : { picks: [], orders: {} };
}

function orderFor(state, round) {
  const o = state.orders && state.orders[round];
  return Array.isArray(o) && o.length === 3 && MANAGERS.every((m) => o.includes(m)) ? o : MANAGERS.slice();
}
const snake = (i, order) => order[Math.floor(i / 3) % 2 === 0 ? i % 3 : 2 - (i % 3)];

export default async (req) => {
  const store = getStore({ name: "league", consistency: "strong" });

  if (req.method === "GET") return json(await readState(store));
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const pin = process.env.LEAGUE_PIN;
  if (pin && String(body.pin || "") !== String(pin)) return json({ error: "Wrong PIN" }, 401);

  const state = await readState(store);
  state.orders = state.orders || {};

  if (body.action === "pick") {
    const p = body.pick || {};
    if (!ROUNDS.includes(p.round) || !SLOTS[p.slot] || !p.name || !p.key) return json({ error: "Incomplete pick." }, 400);
    const inRound = state.picks.filter((x) => x.round === p.round);
    if (inRound.length >= PER_ROUND) return json({ error: "This round's draft is already complete." }, 400);
    if (p.n !== inRound.length + 1) return json({ error: "Someone just made this pick." }, 409);
    const manager = snake(inRound.length, orderFor(state, p.round));
    if (p.manager !== manager) return json({ error: `It's ${manager}'s pick.` }, 409);
    if (inRound.some((x) => x.key === p.key)) return json({ error: `${p.name} was already taken this round.` }, 400);
    if (state.picks.some((x) => x.manager === manager && x.key === p.key)) return json({ error: `${manager} already used ${p.name} in an earlier round.` }, 400);
    const filled = inRound.filter((x) => x.manager === manager && x.slot === p.slot).length;
    if (filled >= SLOTS[p.slot]) return json({ error: `${manager}'s ${p.slot} slots are full.` }, 400);
    const pick = {
      id: `${p.round}-${String(p.n).padStart(2, "0")}`,
      round: p.round, n: p.n, manager, name: String(p.name).slice(0, 80), team: String(p.team || "").slice(0, 4),
      slot: p.slot, key: String(p.key).slice(0, 80), at: new Date().toISOString(),
    };
    if (Number.isInteger(p.mlbId)) pick.mlbId = p.mlbId;
    if (p.il) pick.il = true;
    state.picks.push(pick);
  } else if (body.action === "undo") {
    const i = state.picks.findIndex((x) => x.id === body.id);
    if (i < 0) return json({ error: "That pick no longer exists." }, 409);
    const target = state.picks[i];
    const last = state.picks.filter((x) => x.round === target.round).sort((a, b) => b.n - a.n)[0];
    if (last.id !== target.id) return json({ error: "Only the most recent pick can be undone." }, 409);
    state.picks.splice(i, 1);
  } else if (body.action === "order") {
    if (!ROUNDS.includes(body.round)) return json({ error: "Unknown round." }, 400);
    if (state.picks.some((x) => x.round === body.round)) return json({ error: "Draft order is locked once picks start." }, 400);
    const o = body.order;
    if (!Array.isArray(o) || o.length !== 3 || !MANAGERS.every((m) => o.includes(m))) return json({ error: "Bad order." }, 400);
    state.orders[body.round] = o;
  } else {
    return json({ error: "Unknown action." }, 400);
  }

  state.updatedAt = new Date().toISOString();
  await store.setJSON("state", state);
  return json(state);
};

export const config = { path: "/api/league" };
