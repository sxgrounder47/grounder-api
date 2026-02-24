/**
 * Grounder API — /api/team_history (Sportmonks v3)
 *
 * Retourne l'historique des matchs d'une équipe sur une plage de dates.
 *
 * Params:
 *   teamId    : Sportmonks team ID (number)
 *   startDate : "YYYY-MM-DD"
 *   endDate   : "YYYY-MM-DD"
 *   page      : page number (default 1)
 */

const SM_TOKEN = process.env.SPORTMONKS_TOKEN || "ZCYsAeTUx6YP8phj1J0QsWL9ErxXmDl1DhKS6GfAXu3xyQBpXWguhyZG1aYH";
const SM_BASE  = "https://api.sportmonks.com/v3/football";

function extractScores(scores) {
  if (!scores?.length) return { home: null, away: null };
  let home = null, away = null;
  for (const s of scores) {
    const desc = s.description ?? "";
    if (desc === "CURRENT" || desc === "2ND_HALF" || desc === "AFTER_PENS") {
      if (s.score?.participant === "home") home = s.score.goals;
      if (s.score?.participant === "away") away = s.score.goals;
    }
  }
  return { home, away };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { teamId, startDate, endDate, page = "1" } = req.query;

  if (!teamId || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing teamId, startDate or endDate" });
  }

  try {
    // GET fixtures between dates for a specific team
    const url = new URL(`${SM_BASE}/fixtures/between/${startDate}/${endDate}/teams/${teamId}`);
    url.searchParams.set("api_token", SM_TOKEN);
    url.searchParams.set("include", "participants;scores;venue;league");
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", page);
    url.searchParams.set("order", "starting_at desc");

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).json({ error: txt });
    }

    const data = await upstream.json();
    const fixtures = data.data ?? [];
    const hasMore = data.pagination?.has_more ?? false;

    const matches = fixtures.map(f => {
      const participants = f.participants ?? [];
      const home = participants.find(p => p.meta?.location === "home");
      const away = participants.find(p => p.meta?.location === "away");
      const score = extractScores(f.scores ?? []);

      // Determine result for this team
      let result = null;
      if (score.home !== null && score.away !== null) {
        const isHome = home?.id === Number(teamId);
        if (isHome) {
          result = score.home > score.away ? "W" : score.home < score.away ? "L" : "D";
        } else {
          result = score.away > score.home ? "W" : score.away < score.home ? "L" : "D";
        }
      }

      return {
        id:         f.id,
        date:       f.starting_at?.slice(0, 10) ?? null,
        utcDate:    f.starting_at ? new Date(f.starting_at).toISOString() : null,
        competition: {
          id:   `SM:${f.league_id}`,
          name: f.league?.name ?? null,
        },
        venue:      f.venue ? { name: f.venue.name } : null,
        homeTeam: home ? {
          id:    home.id,
          name:  home.name,
          crest: home.image_path ?? null,
        } : { id: null, name: "?" },
        awayTeam: away ? {
          id:    away.id,
          name:  away.name,
          crest: away.image_path ?? null,
        } : { id: null, name: "?" },
        score: { home: score.home, away: score.away },
        result, // "W" | "L" | "D" | null — from the perspective of teamId
      };
    });

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
    return res.status(200).json({ matches, hasMore, page: Number(page) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
