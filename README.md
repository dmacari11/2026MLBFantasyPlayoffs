# 2026 Fantasy MLB Playoffs

Dan vs Dio vs CK: a snake-draft fantasy league for the MLB postseason.

## What's in here
- `public/index.html` – the site
- `public/rosters.json` – every team's 40-man roster (incl. IL), pitchers tagged SP / RP
- `netlify/functions/league.mjs` – saves draft picks and draft order (Netlify Blobs)
- `netlify/functions/stats.mjs` – pulls live box scores from MLB's public Stats API (~1 min refresh)

## Deploy (one time)
1. Put this folder in a GitHub repository.
2. On Netlify: Add new site → Import an existing project → GitHub → pick the repo → Deploy. No build settings needed (they come from netlify.toml).
3. Site configuration → Environment variables → Add a variable: LEAGUE_PIN = a PIN you share with Dio and CK. Then Deploys → Trigger deploy.
4. Optional: Site configuration → Change site name (e.g. fantasy-mlb-playoffs → fantasy-mlb-playoffs.netlify.app).

Anyone with the link can view. Making picks, undoing a pick or changing draft order asks for the PIN once per device.

## Link previews
`public/og-image.png` is the preview image shown when the link is shared. The tags in `index.html` point to
`https://mlbfantasyplayoffs.netlify.app/og-image.png`. If you pick a different Netlify site name, change that
address in the two `og:image` / `twitter:image` lines to match.
