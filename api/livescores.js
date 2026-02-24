/**
 * Grounder API — /api/livescores (Sportmonks v3)
 *
 * Retourne tous les matchs en cours dans les ligues de l'abonnement.
 * Utilisé par le feed accueil et le badge LIVE du calendrier.
 */

const SM_TOKEN = process.env.SPORTMONKS_TOKEN || "ZCYsAeTUx6YP8phj1J0QsWL9ErxXmDl1DhKS6GfAXu3xyQBpXWguhyZG1aYH";
const SM_BASE  = "https://api.sportmonks.com/v3/football";

function mapState(stateId) {
  const map = {
    1: "SCHEDULED", 2: "IN_PLAY", 3: "HALFTIME", 4: "IN_PLAY",
    5: "FINISHED", 6: "FINISHED", 7: "FINISHED", 8: "PAUSED",
    9: "CANCELLED", 10: "POSTPONED", 12: "LIVE", 17: "IN_PLAY", 26: "IN_PLAY",
  };
  return map[stateId] ?? "SCHEDULED";
}

function extractScores(scores) {
  if (!scores?.length) return { winner: null, fullTime: { home: null, away: null }, halfTime: { home: null, away: null } };
  let ftHome = null, ftAway = null, htHome = null, htAway = null;
  for (const s of scores) {
    const desc = s.description ?? "";
    const goals = s.score?.goals ?? null;
    const part = s.score?.participant ?? "";
    if (desc === "CURRENT" || desc === "2ND_HALF") {
      if (part === "home") ftHome = goals;
      if (part === "away") ftAway = goals;
    }
    if (desc === "1ST_HALF") {
      if (part === "home") htHome = goals;
      if (part === "away") htAway = goals;
    }
  }
  return { winner: null, fullTime: { home: ftHome, away: ftAway }, halfTime: { home: htHome, away: htAway } };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const url = new URL(`${SM_BASE}/livescores/inplay`);
    url.searchParams.set("api_token", SM_TOKEN);
    url.searchParams.set("include", "participants;scores;league;venue;state");
    url.searchParams.set("per_page", "100");

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).json({ error: txt });
    }

    const data = await upstream.json();
    const fixtures = data.data ?? [];

    const matches = fixtures.map(f => {
      const participants = f.participants ?? [];
      const home = participants.find(p => p.meta?.location === "home");
      const away = participants.find(p => p.meta?.location === "away");
      const scores = extractScores(f.scores ?? []);

      return {
        id:       f.id,
        utcDate:  f.starting_at ? new Date(f.starting_at).toISOString() : null,
        status:   mapState(f.state_id),
        minute:   f.minute ?? null,
        venue:    f.venue ? { name: f.venue.name } : null,
        competition: {
          id:   `SM:${f.league_id}`,
          name: f.league?.name ?? null,
        },
        homeTeam: home ? {
          id: home.id, name: home.name,
          shortName: home.short_code ?? home.name,
          tla: home.short_code ?? home.name?.slice(0,3).toUpperCase(),
          crest: home.image_path ?? null,
        } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
        awayTeam: away ? {
          id: away.id, name: away.name,
          shortName: away.short_code ?? away.name,
          tla: away.short_code ?? away.name?.slice(0,3).toUpperCase(),
          crest: away.image_path ?? null,
        } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
        score: scores,
      };
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ matches });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
