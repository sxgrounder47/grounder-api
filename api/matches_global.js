/**
 * Grounder API — /api/matches_global (Sportmonks v3)
 *
 * Remplace Football-Data.org par Sportmonks v3.
 * Conserve exactement le même format de réponse pour le frontend.
 *
 * Params:
 *   competitionId : "FD:2015" (Ligue 1), "FD:2021" (PL), etc.
 *   date          : "YYYY-MM-DD"
 */

const SM_TOKEN = process.env.SPORTMONKS_TOKEN || "ZCYsAeTUx6YP8phj1J0QsWL9ErxXmDl1DhKS6GfAXu3xyQBpXWguhyZG1aYH";
const SM_BASE  = "https://api.sportmonks.com/v3/football";

// Mapping FD competition IDs → Sportmonks league IDs
// Vérifie via https://api.sportmonks.com/v3/football/leagues?api_token=TOKEN
const LEAGUE_MAP = {
  "FD:2015": 301,   // Ligue 1
  "FD:2021": 8,     // Premier League
  "FD:2002": 82,    // Bundesliga
  "FD:2014": 564,   // La Liga
  "FD:2019": 384,   // Serie A
  "FD:2001": 2,     // UEFA Champions League
  "FD:2146": 5,     // UEFA Europa League
  "FD:2003": 72,    // Eredivisie
  "FD:2016": 1067,  // Championship
  "FD:2013": 325,   // Brasileirão
};

// Sportmonks state_id → statut Grounder
// https://docs.sportmonks.com/v3/definitions/states
function mapState(stateId) {
  // 1 = NS (Not Started), 2 = LIVE, 3 = HT, 5 = FT, 6 = AET, 7 = PEN, 9 = ABN, 10 = POSTP
  const map = {
    1:  "SCHEDULED",
    2:  "IN_PLAY",
    3:  "HALFTIME",
    4:  "IN_PLAY",   // 2nd half
    5:  "FINISHED",
    6:  "FINISHED",  // After extra time
    7:  "FINISHED",  // After penalties
    8:  "PAUSED",
    9:  "CANCELLED",
    10: "POSTPONED",
    11: "AWARDED",
    12: "LIVE",
    17: "IN_PLAY",   // Extra time
    26: "IN_PLAY",   // Penalties
    31: "CANCELLED",
    44: "SCHEDULED", // To be announced
  };
  return map[stateId] ?? "SCHEDULED";
}

// Extrait le score FT depuis le tableau scores[] de Sportmonks
function extractScores(scores) {
  if (!scores || !scores.length) {
    return { winner: null, fullTime: { home: null, away: null }, halfTime: { home: null, away: null } };
  }

  let ftHome = null, ftAway = null, htHome = null, htAway = null;

  for (const s of scores) {
    const desc = s.description ?? "";
    const goals = s.score?.goals ?? null;
    const participant = s.score?.participant ?? "";

    if (desc === "CURRENT" || desc === "2ND_HALF") {
      if (participant === "home") ftHome = goals;
      if (participant === "away") ftAway = goals;
    }
    if (desc === "1ST_HALF") {
      if (participant === "home") htHome = goals;
      if (participant === "away") htAway = goals;
    }
  }

  // Determine winner
  let winner = null;
  if (ftHome !== null && ftAway !== null) {
    if (ftHome > ftAway) winner = "HOME_TEAM";
    else if (ftAway > ftHome) winner = "AWAY_TEAM";
    else winner = "DRAW";
  }

  return {
    winner,
    fullTime:  { home: ftHome, away: ftAway },
    halfTime:  { home: htHome, away: htAway },
  };
}

// Transforme un fixture Sportmonks → format Grounder
function transformFixture(fixture, leagueName, competitionId) {
  const participants = fixture.participants ?? [];
  const homeTeam = participants.find(p => p.meta?.location === "home");
  const awayTeam = participants.find(p => p.meta?.location === "away");

  const venue = fixture.venue ?? null;
  const venueObj = venue ? { name: venue.name ?? null, city: null } : null;

  const status = mapState(fixture.state_id);
  const scores = extractScores(fixture.scores ?? []);

  // Minute en cours pour les matchs live
  let minute = null;
  if (status === "IN_PLAY" || status === "LIVE" || status === "HALFTIME") {
    const periods = fixture.periods ?? [];
    const lastPeriod = periods[periods.length - 1];
    if (lastPeriod?.ticking) {
      const elapsed = Math.floor((Date.now() / 1000 - lastPeriod.started) / 60);
      minute = Math.min(elapsed + (lastPeriod.sort_order === 1 ? 0 : 45), 90);
    }
    if (fixture.minute) minute = fixture.minute;
  }

  return {
    id:       fixture.id,
    utcDate:  fixture.starting_at ? new Date(fixture.starting_at).toISOString() : null,
    status,
    minute,
    venue:    venueObj,
    competition: {
      id:   competitionId,
      name: leagueName,
    },
    homeTeam: homeTeam ? {
      id:        homeTeam.id,
      name:      homeTeam.name,
      shortName: homeTeam.short_code ?? homeTeam.name,
      tla:       homeTeam.short_code ?? homeTeam.name?.slice(0, 3).toUpperCase(),
      crest:     homeTeam.image_path ?? null,
    } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
    awayTeam: awayTeam ? {
      id:        awayTeam.id,
      name:      awayTeam.name,
      shortName: awayTeam.short_code ?? awayTeam.name,
      tla:       awayTeam.short_code ?? awayTeam.name?.slice(0, 3).toUpperCase(),
      crest:     awayTeam.image_path ?? null,
    } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
    score: scores,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { competitionId, date } = req.query;

  if (!competitionId || !date) {
    return res.status(400).json({ error: "Missing competitionId or date" });
  }

  const leagueId = LEAGUE_MAP[competitionId];
  if (!leagueId) {
    return res.status(400).json({ error: `Unknown competitionId: ${competitionId}` });
  }

  try {
    // GET fixtures by date, filtered by league
    const url = new URL(`${SM_BASE}/fixtures/date/${date}`);
    url.searchParams.set("api_token", SM_TOKEN);
    url.searchParams.set("include", "participants;scores;venue;state;periods");
    url.searchParams.set("filters", `fixtureLeagues:${leagueId}`);
    url.searchParams.set("per_page", "50");

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).json({ error: txt });
    }

    const data = await upstream.json();
    const fixtures = data.data ?? [];

    // Get league name from first fixture or fallback
    const leagueNames = {
      "FD:2015": "Ligue 1",
      "FD:2021": "Premier League",
      "FD:2002": "Bundesliga",
      "FD:2014": "La Liga",
      "FD:2019": "Serie A",
      "FD:2001": "Champions League",
      "FD:2146": "Europa League",
      "FD:2003": "Eredivisie",
      "FD:2016": "Championship",
      "FD:2013": "Brasileirão",
    };

    const matches = fixtures.map(f => transformFixture(f, leagueNames[competitionId] ?? competitionId, competitionId));

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({ matches });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
