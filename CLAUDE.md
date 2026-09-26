# 2026 Fantasy MLB Playoffs: project guide

A private fantasy league for the 2026 MLB postseason between three friends: **Dan, Dio and CK**.
Live site: https://mlbfantasyplayoffs.netlify.app (Netlify project `mlbfantasyplayoffs`, deploys automatically from `main`).
The owner (Dan) is not a developer. Explain changes in plain language, keep his workflow simple, and push finished work straight to `main`.

## League rules (the page must enforce these)
- Four drafts, one per round: **WC** (Wild Card), **DS** (Division Series), **CS** (LCS, labelled "LCS"), **WS** (World Series).
- Each draft is an **18-pick snake** (3 managers × 6 picks). Every manager takes **3 hitters (H), 2 starting pitchers (SP), 1 relief pitcher (RP)**.
- Draft order is set per round before the first pick; it locks once picks start. Default order: Dan, Dio, CK.
- A player can be drafted by anyone once per round, but **a manager can never draft the same player twice across the whole postseason**.
- A player's stats count **only in the round he was drafted in** (MLB gameType F=WC, D=DS, L=CS, W=WS).
- Injured-list players are draftable (shown with an IL tag); it's the manager's call.
- Pitchers can only go in slots they're eligible for (see "Rosters" below). Two-way players (pos `TWP`, e.g. Ohtani) can go in H or SP.

## Scoring
- 10 categories. Batting: R, HR, RBI, SB, OPS. Pitching: W, K, ERA, WHIP, SV+H (saves + holds).
- Hitting stats come only from H picks; pitching stats only from SP/RP picks.
- OPS, ERA and WHIP are computed from summed components (OBP = (H+BB+HBP)/(AB+BB+HBP+SF); SLG = TB/AB; ERA = ER×27/outs; WHIP = (BB+H)×3/outs), never averaged.
- **Head-to-head-to-head per category:** the outright leader gets a **W**, the other two get an **L**. If two or three tie for the lead, each tied leader gets a **T** and anyone else gets an **L**. Lower wins for ERA and WHIP. A category nobody has stats in yet is undecided (no result).
- Standings = W-L-T record, sorted by wins, then ties. Pct (shown like Yahoo) = (W + T/2) / decided categories. GB uses Yahoo's formula.
- Standings are shown overall (all rounds combined) and per round, plus a round-by-round records table.

## Bracket pool (Bracket tab)
- A separate side game: each manager picks the winner of all 11 postseason series (4 WC, 4 DS, 2 LCS, WS). Points: **WC 1, DS 2, LCS 4, WS 8**, awarded only when the picked team actually wins that series.
- Bracket (2026 format, 6 teams per league): seeds 1–3 = division winners by record, 4–6 = wild cards. WC: 3v6, 4v5. DS: 1 vs 4/5 winner, 2 vs 3/6 winner. Then LCS, WS.
- Before the playoffs the field follows live MLB standings (`/standings?leagueId=103,104&standingsTypes=regularSeason`). Picks lock at the first Wild Card first pitch (earliest non-TBD `gameType=F` gameDate; fallback 2026-09-29T16:00Z) or once any postseason game is live; the field is then frozen in Blobs key `bracket-field`.
- Blobs keys: `bracket-picks-<Manager>` = `{slot: teamId}` (slots `AL-WC1` 3v6, `AL-WC2` 4v5, `AL-DS1`, `AL-DS2`, `AL-CS`, same for NL, `WS`); `bracket-mlb` = cached standings field + series results (refreshed at most every 60 s). Picks that no longer fit the bracket are pruned (server on save, client on display).
- Series winners are computed from final postseason games (wins needed: WC 2, DS 3, LCS 4, WS 4). Like stats.mjs, only tested against simulated MLB data; confirm with real data once standings/postseason games exist.
- Everyone's picks are visible to all three managers.
- Layout is a real two-sided bracket: AL on the left (WC → DS → LCS), NL mirrored on the right, World Series + champion pick in the middle, with CSS connector lines. On phones it shows logos only (seed in the corner), no sideways scrolling.
- Team logos load from MLB's CDN `https://www.mlbstatic.com/team-logos/<teamId>.svg` (owner asked for real logos in the bracket). If a logo fails, the abbreviation shows instead. The no-MLB-logos rule still applies to og-image.png.

## Architecture
```
public/index.html        whole front end (HTML + CSS + vanilla JS, no build step)
public/rosters.json      { TEAM: [ {id, name, pos, s, role?} ] }, 30 teams, 40-man incl. IL
public/og-image.png      1200×630 link-preview image (original art; do NOT use MLB logos)
netlify/functions/league.mjs   GET/POST /api/league: picks + draft order, stored in Netlify Blobs
netlify/functions/stats.mjs    GET /api/stats: live box scores from MLB Stats API, cached in Blobs
netlify/functions/bracket.mjs  GET/POST /api/bracket: bracket pool (field from standings, picks, series results)
netlify/functions/playerstats.mjs  GET /api/playerstats?team=X&ids=..: 2026 season stats for a roster (MLB `/people?personIds=..&hydrate=stats(...)`, full season across teams), cached 6 h in Blobs `pstats-<TEAM>`
netlify.toml, package.json     (@netlify/blobs is the only dependency)
```
- **Blobs store `league`:** key `state` = `{picks:[...], orders:{WC:[..]}, updatedAt}`; key `stats` = `{lines, fetchedAt, sig}`; keys `box-<gamePk>` = cached boxscores of *final* games.
- **Pick object:** `{id:"WC-01", round, n, manager, name, team, slot:"H"|"SP"|"RP", key, mlbId?, il?, at}`. `key` = name lowercased, accents stripped, non-alphanumerics removed (used for duplicate/reuse checks).
- **`POST /api/league` actions:** `pick {pick}`, `undo {id}` (only the latest pick of that round), `order {round, order}`. The server re-validates turn order, duplicates, reuse and slot limits.
- **Optional PIN:** if the env var `LEAGUE_PIN` is set, POSTs require it (the page prompts once and stores it in localStorage). It is **not** set, by the owner's choice: anyone with the link can draft.
- **Stats:** `stats.mjs` fetches `schedule?sportId=1&gameType=F,D,L,W&startDate=2026-09-28&endDate=<today ET>&hydrate=team`, then `game/<pk>/boxscore` for Live/Final games that have drafted players in that round, matching players by `ID<mlbId>`. It emits one line per player per game: hitters `{ab,h,d,t,hr,r,rbi,sb,bb,hbp,sf}`, pitchers `{outs,h,er,bb,k,w,sv,hld}`. It refreshes at most every 45 s, or immediately when the set of picks changes (`sig`).
- **Client polling:** league every 6 s on the Draft tab (45 s elsewhere), stats every 60 s. Polling pauses while the tab is hidden.

## Front end notes (public/index.html)
- Tabs: **Standings, Rosters, Draft, Bracket** (a Rules tab was removed on purpose).
- Before the first real pick, Standings/Rosters show clearly labelled **example data** (`DEMO`).
- Rendering is string templates → `#main.innerHTML`. `render()` **skips while a `<select>` in #main is focused** (phones close native pickers when the element is replaced) and catches up on focusout. Keep this.
- Only text inputs get focus restored after render, never selects.
- Draft room: team drop-down → scrollable **player table with 2026 regular-season stats** (Hitters/Pitchers toggle; hitters R/HR/RBI/SB/OPS, pitchers W/K/ERA/WHIP/SV+H; tap a header to sort, default HR / K; OPS needs 50 AB and ERA/WHIP 20 IP to rank; IL tag; taken/used players greyed and not tappable; tap a row to select) → H/SP/RP slot buttons (ineligible slots disabled) → Draft button. The table keeps its scroll position across re-renders, and polling only re-renders when data actually changed. The slot he'll fill is highlighted but stays "Empty"; the name only appears on the team after Draft is clicked (owner's request).
- The team drop-down lists only playoff teams, taken from the Bracket tab's field (`draftTeams()`): WC round = seeds 3–6 (seeds 1–2 have byes); DS/LCS/WS = every playoff team not yet knocked out. Falls back to all 30 teams if the bracket data can't load.
- The phone layout (≤640px) keeps the draft compact (the player table makes it taller than one screen): compact clock card, three team columns side by side, **full player names wrapping to two lines**, pick strip and locked draft-order box hidden.
- **No horizontal scrolling on phones, ever.** Tables are transposed or reflowed instead (the category table flips to rows = categories on phones). Inputs/selects are 16px on phones so iOS doesn't zoom.
- Manual stat-line entry was intentionally removed (`editable=false`); stats are automatic only.

## Design system (friendly middle ground: fun, not cartoonish)
- Fonts (Google Fonts): **Fredoka** (headings/UI), **Nunito Sans** (body), **DM Mono** (numbers).
- Tokens live in `:root` with light and dark variants; the last theme block in the CSS is "FRIENDLY THEME" and overrides earlier ones.
- Manager colours: Dan `--dan` blue #3B76F6, Dio `--dio` orange #F28A2E, CK `--ck` teal #14A895. Avatar initials: **Dan = DM, Dio = CD, CK = CK**.
- Primary/accent coral #F25C4B; title reads "2026 Fantasy **MLB Playoffs**" (second half in coral) next to a small tilted baseball SVG. No tagline under the title, no round-status tiles.
- Category cells: outright leader = light green background (`--win-cell`), tied for lead = light grey (`--tie-cell`), others white. No "T" markers in category cells.

## Rosters (public/rosters.json)
- Built from `https://statsapi.mlb.com/api/v1/teams/<teamId>/roster?rosterType=40Man` (keep players whose status isn't "Reassigned to Minors", unless they're on the active roster). `s` = `A` (active) or `IL`.
- Pitcher `role` comes from 2026 appearances (`/api/v1/stats?stats=season&group=pitching&season=2026&teamId=<id>&playerPool=ALL`): **SP if GS ≥ 5 or GS/G ≥ 0.5; RP if relief apps ≥ 5 or relief/G ≥ 0.5; both → `SP/RP`; no appearances → `SP/RP`.**
- MLB rosters change before each round, so offer to refresh rosters.json before each draft.

## Open items / to verify
- The MLB Stats API path in `stats.mjs` has only been tested against a simulated feed. After the first Wild Card game (Sep 29, 2026), confirm `/api/stats` returns real lines (SB, HBP, SF, holds included) and fix field mapping if not.
- Postseason dates: WC Sep 29–Oct 1, DS Oct 3–10, LCS Oct 11–20, WS Oct 23–31 (2026).
