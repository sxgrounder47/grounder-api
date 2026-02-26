/**
 * Grounder API — Point d'entrée unique (Sportmonks v3)
 *
 * Toutes les routes dans un seul fichier pour respecter la limite Vercel Hobby (12 fonctions).
 * Le routing se fait via le champ "path" de vercel.json.
 *
 * Routes :
 *   GET /api/matches_global?competitionId=FD:2015&date=2026-02-24
 *   GET /api/livescores
 *   GET /api/team_history?team=RC+Lens&dateFrom=2025-07-01&dateTo=2026-06-30
 *   GET /api/team_history?teamId=2672&dateFrom=2025-07-01&dateTo=2026-06-30
 *   GET /api/leagues
 *   GET /api/competitions_global   (liste statique des compétitions supportées)
 *   GET /api/stadiums_global       (proxy vers staticDb / Wikidata)
 */

const SM_TOKEN = process.env.SPORTMONKS_TOKEN || "V7imvWbLaBsOlqcA2rFVfQvfMoaXUGqxSlkCPnVZjgJl5KPGfnUqalUX0Qzv";
const SM_BASE  = "https://api.sportmonks.com/v3/football";

// ─── API-Football (fallback pour team_history) ────────────────────────────────
const AF_TOKEN = process.env.API_FOOTBALL_TOKEN || "";
const AF_BASE  = "https://v3.football.api-sports.io";

// ─── Mapping FD: IDs → Sportmonks league IDs (vérifié via /api/leagues) ──────
const LEAGUE_MAP = {
  // Ligues principales
  "FD:2015": 301,   // Ligue 1
  "FD:2021": 8,     // Premier League (England)
  "FD:2002": 82,    // Bundesliga
  "FD:2014": 564,   // La Liga
  "FD:2019": 384,   // Serie A
  "FD:2003": 72,    // Eredivisie
  "FD:2016": 9,     // Championship
  "FD:2017": 462,   // Liga Portugal
  // Coupes nationales
  "FD:2055": 24,    // FA Cup
  "FD:2056": 27,    // Carabao Cup
  "FD:2099": 390,   // Coppa Italia
  "FD:2079": 570,   // Copa Del Rey
  // Autres ligues européennes
  "SM:181":  181,   // Admiral Bundesliga (Autriche)
  "SM:208":  208,   // Pro League (Belgique)
  "SM:244":  244,   // 1. HNL (Croatie)
  "SM:271":  271,   // Superliga (Danemark)
  "SM:387":  387,   // Serie B (Italie)
  "SM:444":  444,   // Eliteserien (Norvège)
  "SM:453":  453,   // Ekstraklasa (Pologne)
  "SM:486":  486,   // Premier League (Russie/autre)
  "SM:501":  501,   // Premiership (Écosse)
  "SM:567":  567,   // La Liga 2
  "SM:573":  573,   // Allsvenskan (Suède)
  "SM:591":  591,   // Super League (Suisse)
  "SM:600":  600,   // Super Lig (Turquie)
};

const LEAGUE_NAMES = {
  "FD:2015": "Ligue 1",
  "FD:2021": "Premier League",
  "FD:2002": "Bundesliga",
  "FD:2014": "La Liga",
  "FD:2019": "Serie A",
  "FD:2003": "Eredivisie",
  "FD:2016": "Championship",
  "FD:2017": "Liga Portugal",
  "FD:2055": "FA Cup",
  "FD:2056": "Carabao Cup",
  "FD:2099": "Coppa Italia",
  "FD:2079": "Copa Del Rey",
  "SM:181":  "Bundesliga (AUT)",
  "SM:208":  "Pro League",
  "SM:244":  "1. HNL",
  "SM:271":  "Superliga",
  "SM:387":  "Serie B",
  "SM:444":  "Eliteserien",
  "SM:453":  "Ekstraklasa",
  "SM:486":  "Premier League (SCO/RUS)",
  "SM:501":  "Premiership",
  "SM:567":  "La Liga 2",
  "SM:573":  "Allsvenskan",
  "SM:591":  "Super League",
  "SM:600":  "Super Lig",
};

// ─── Helpers Sportmonks ───────────────────────────────────────────────────────

function mapState(stateId) {
  const map = {
    1: "SCHEDULED", 2: "IN_PLAY", 3: "HALFTIME", 4: "IN_PLAY",
    5: "FINISHED",  6: "FINISHED", 7: "FINISHED", 8: "PAUSED",
    9: "CANCELLED", 10: "POSTPONED", 11: "AWARDED",
    12: "LIVE", 17: "IN_PLAY", 26: "IN_PLAY",
    31: "CANCELLED", 44: "SCHEDULED",
  };
  return map[stateId] ?? "SCHEDULED";
}

function extractScores(scores) {
  if (!scores?.length) {
    return { winner: null, fullTime: { home: null, away: null }, halfTime: { home: null, away: null } };
  }
  let ftHome = null, ftAway = null, htHome = null, htAway = null;
  for (const s of scores) {
    const desc = s.description ?? "";
    const goals = s.score?.goals ?? null;
    const part  = s.score?.participant ?? "";
    if (desc === "CURRENT" || desc === "2ND_HALF" || desc === "AFTER_PENS") {
      if (part === "home") ftHome = goals;
      if (part === "away") ftAway = goals;
    }
    if (desc === "1ST_HALF") {
      if (part === "home") htHome = goals;
      if (part === "away") htAway = goals;
    }
  }
  let winner = null;
  if (ftHome !== null && ftAway !== null) {
    winner = ftHome > ftAway ? "HOME_TEAM" : ftAway > ftHome ? "AWAY_TEAM" : "DRAW";
  }
  return { winner, fullTime: { home: ftHome, away: ftAway }, halfTime: { home: htHome, away: htAway } };
}

function transformFixture(f, competitionId) {
  const participants = f.participants ?? [];
  const home = participants.find(p => p.meta?.location === "home");
  const away = participants.find(p => p.meta?.location === "away");
  const scores = extractScores(f.scores ?? []);

  return {
    id:      f.id,
    utcDate: f.starting_at ? new Date(f.starting_at).toISOString() : null,
    status:  mapState(f.state_id),
    minute:  f.minute ?? null,
    venue:   null,
    competition: {
      id:   competitionId ?? `SM:${f.league_id}`,
      name: LEAGUE_NAMES[competitionId] ?? f.league?.name ?? null,
    },
    homeTeam: home ? {
      id: home.id, name: home.name,
      shortName: home.short_code ?? home.name,
      tla:       home.short_code ?? home.name?.slice(0, 3).toUpperCase(),
      crest:     home.image_path ?? null,
    } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
    awayTeam: away ? {
      id: away.id, name: away.name,
      shortName: away.short_code ?? away.name,
      tla:       away.short_code ?? away.name?.slice(0, 3).toUpperCase(),
      crest:     away.image_path ?? null,
    } : { id: null, name: "?", shortName: "?", tla: "?", crest: null },
    score: scores,
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleMatchesGlobal(req, res) {
  const { competitionId, date } = req.query;
  if (!competitionId || !date) return res.status(400).json({ error: "Missing competitionId or date" });

  const leagueId = LEAGUE_MAP[competitionId];
  if (!leagueId) return res.status(400).json({ error: `Unknown competitionId: ${competitionId}` });

  const url = new URL(`${SM_BASE}/fixtures/date/${date}`);
  url.searchParams.set("api_token", SM_TOKEN);
  url.searchParams.set("include", "participants;scores;state");
  url.searchParams.set("filters", `fixtureLeagues:${leagueId}`);
  url.searchParams.set("per_page", "50");

  const r = await fetch(url.toString());
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });

  const data = await r.json();
  const matches = (data.data ?? []).map(f => transformFixture(f, competitionId));

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
  return res.status(200).json({ matches });
}

async function handleLivescores(req, res) {
  const url = new URL(`${SM_BASE}/livescores/inplay`);
  url.searchParams.set("api_token", SM_TOKEN);
  url.searchParams.set("include", "participants;scores;league;state");
  url.searchParams.set("per_page", "100");

  const r = await fetch(url.toString());
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });

  const data = await r.json();
  const matches = (data.data ?? []).map(f => transformFixture(f, null));

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ matches });
}

// Résolution nom d'équipe → Sportmonks team ID
// ─── Mapping nom club → Sportmonks team ID (vérifié via matches_global) ────────
const SM_TEAM_IDS = {
  // 🇫🇷 Ligue 1
  "Paris Saint-Germain": 591, "Olympique Marseille": 44, "Olympique de Marseille": 44,
  "Olympique Lyonnais": 79, "RC Lens": 271, "LOSC Lille": 690,
  "Stade Rennais FC": 598, "Rennes": 598, "OGC Nice": 450, "Nice": 450,
  "AS Monaco": 6789, "Monaco": 6789, "FC Nantes": 59, "Nantes": 59,
  "RC Strasbourg": 686, "Strasbourg": 686, "Toulouse FC": 289, "Toulouse": 289,
  "Stade Brestois 29": 266, "Brest": 266, "Le Havre AC": 1055, "Le Havre": 1055,
  "Angers SCO": 776, "Angers": 776, "Lorient": 9257, "AJ Auxerre": 3682, "Auxerre": 3682,
  "FC Metz": 3513, "Metz": 3513, "Paris FC": 4508,
  // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League
  "Manchester United": 14, "Manchester City": 9, "Liverpool FC": 8, "Liverpool": 8,
  "Arsenal FC": 2, "Arsenal": 2, "Chelsea FC": 3, "Chelsea": 3,
  "Tottenham Hotspur": 6, "Tottenham": 6, "Aston Villa": 21, "Newcastle United": 17,
  "Brighton & Hove Albion": 61, "West Ham United": 29, "Brentford": 7938,
  "Fulham": 574, "Wolverhampton Wanderers": 351, "Crystal Palace": 1388,
  "Everton": 51, "Bournemouth": 521, "Ipswich Town": 21390, "Leicester City": 31,
  // 🇩🇪 Bundesliga
  "FC Bayern München": 396, "Borussia Dortmund": 394, "Bayer Leverkusen": 393,
  "VfB Stuttgart": 401, "Eintracht Frankfurt": 400, "RB Leipzig": 3728,
  // 🇪🇸 La Liga
  "Real Madrid CF": 732, "FC Barcelona": 83, "Atlético de Madrid": 80,
  "Sevilla FC": 226, "Real Betis": 84, "Athletic Club": 121,
  "Real Sociedad": 85, "Villarreal CF": 209,
  // 🇮🇹 Serie A
  "AC Milan": 3024, "Inter Milan": 3025, "Juventus FC": 3026,
  "SSC Napoli": 3031, "AS Roma": 3029, "SS Lazio": 3030,
  "Atalanta BC": 3027, "ACF Fiorentina": 3028, "Torino FC": 3033,
  // 🇵🇹 Liga Portugal
  "SL Benfica": 1963, "FC Porto": 1968, "Sporting CP": 1967,
  // 🇳🇱 Eredivisie
  "AFC Ajax": 676, "PSV Eindhoven": 663, "Feyenoord": 675,
};

function resolveTeamId(teamName) {
  return SM_TEAM_IDS[teamName] ?? null;
}

async function handleTeamHistory(req, res) {
  let { teamId, team, dateFrom, dateTo, season, page = "1" } = req.query;

  // Résoudre teamId depuis le nom si nécessaire
  if (!teamId && team) {
    teamId = SM_TEAM_IDS[team] ?? null;
    if (!teamId) return res.status(404).json({ error: `Team not found: ${team}` });
  }
  if (!teamId) return res.status(400).json({ error: "Missing teamId or team" });

  // Déterminer la saison depuis dateFrom ou param direct
  // API-Football: /fixtures?team=X&season=YYYY (une saison entière en 1 appel)
  const seasonYear = season
    ? String(season)
    : dateFrom
      ? String(new Date(dateFrom).getFullYear() - (new Date(dateFrom).getMonth() < 6 ? 1 : 0))
      : String(new Date().getFullYear());

  // Mapping SM teamId → AF teamId (à affiner si divergences)
  // Pour l'instant on utilise un mapping AF vérifié pour la Ligue 1
  const AF_TEAM_MAP = {
    591: 85,   // PSG
    44:  81,   // OM
    79:  80,   // OL
    271: 116,  // RC Lens
    690: 79,   // Lille
    598: 97,   // Rennes
    450: 84,   // Nice
    6789:91,   // Monaco
    59:  83,   // Nantes
    686: 95,   // Strasbourg
    289: 94,   // Toulouse
    266: 113,  // Brest
    1055:111,  // Le Havre
    776: 106,  // Angers
    9257:112,  // Lorient
    3682:108,  // Auxerre
    // PL
    14:  33,   // Man Utd
    9:   50,   // Man City
    8:   40,   // Liverpool
    2:   42,   // Arsenal
    3:   49,   // Chelsea
    6:   47,   // Tottenham
    21:  66,   // Aston Villa
    17:  34,   // Newcastle
    // Bundesliga
    396: 157,  // Bayern
    394: 165,  // Dortmund
    393: 168,  // Leverkusen
    // La Liga
    732: 541,  // Real Madrid
    83:  529,  // Barcelona
    80:  530,  // Atletico
    // Serie A
    3024:489,  // AC Milan
    3025:505,  // Inter
    3026:496,  // Juventus
    3031:492,  // Napoli
  };

  const afTeamId = AF_TEAM_MAP[Number(teamId)] ?? Number(teamId);

  const url = new URL(`${AF_BASE}/fixtures`);
  url.searchParams.set("team", String(afTeamId));
  url.searchParams.set("season", seasonYear);

  const r = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": AF_TOKEN,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  if (!r.ok) return res.status(r.status).json({ error: await r.text() });

  const data = await r.json();
  const fixtures = data.response ?? [];

  const matches = fixtures.map(f => {
    const home = f.teams?.home;
    const away = f.teams?.away;
    const goals = f.goals;
    const status = f.fixture?.status?.short;

    const isFinished = ["FT","AET","PEN"].includes(status);
    const isHome = home?.id === afTeamId;

    let result = null;
    if (isFinished && goals?.home !== null && goals?.away !== null) {
      const gf = isHome ? goals.home : goals.away;
      const ga = isHome ? goals.away : goals.home;
      result = gf > ga ? "W" : gf < ga ? "L" : "D";
    }

    const apiStatus = isFinished ? "FINISHED"
      : ["1H","2H","HT","ET","BT","P","LIVE"].includes(status) ? "IN_PLAY"
      : status === "PST" ? "POSTPONED"
      : status === "CANC" ? "CANCELLED"
      : "SCHEDULED";

    return {
      id:      f.fixture?.id,
      utcDate: f.fixture?.date ?? null,
      status:  apiStatus,
      competition: {
        id:   `AF:${f.league?.id}`,
        name: f.league?.name ?? null,
      },
      homeTeam: {
        id:    home?.id ?? null,
        name:  home?.name ?? "?",
        tla:   null,
        crest: home?.logo ?? null,
      },
      awayTeam: {
        id:    away?.id ?? null,
        name:  away?.name ?? "?",
        tla:   null,
        crest: away?.logo ?? null,
      },
      score: {
        fullTime: { home: goals?.home ?? null, away: goals?.away ?? null },
        halfTime: { home: f.score?.halftime?.home ?? null, away: f.score?.halftime?.away ?? null },
      },
      result,
    };
  }).sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  return res.status(200).json({ matches, teamId: Number(teamId), season: seasonYear });
}


async function handleLeagues(req, res) {
  const url = new URL(`${SM_BASE}/leagues`);
  url.searchParams.set("api_token", SM_TOKEN);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("select", "id,name,short_code,image_path,country_id");

  const r = await fetch(url.toString());
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });

  const data = await r.json();
  const leagues = (data.data ?? []).map(l => ({
    id: l.id, name: l.name,
    short_code: l.short_code ?? null,
    logo: l.image_path ?? null,
  }));

  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ leagues });
}

function handleCompetitionsGlobal(req, res) {
  // Liste statique des compétitions supportées avec mapping Sportmonks
  const competitions = Object.entries(LEAGUE_MAP).map(([fdId, smId]) => ({
    id:   fdId,
    smId: smId,
    name: LEAGUE_NAMES[fdId] ?? fdId,
  }));
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ competitions });
}

async function handleStadiumsGlobal(req, res) {
  // Retourne une réponse vide pour l'instant (staticDb est côté client)
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ stadiums: [] });
}

// ─── Router principal ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Vercel passe l'URL complète — on extrait le pathname
  const rawPath = req.url ?? "";
  const pathname = rawPath.split("?")[0].replace(/^\/+/, "");

  // Routing par pathname
  try {
    if (pathname === "api/matches_global")     return await handleMatchesGlobal(req, res);
    if (pathname === "api/livescores")         return await handleLivescores(req, res);
    if (pathname === "api/team_history")       return await handleTeamHistory(req, res);
    if (pathname === "api/leagues")            return await handleLeagues(req, res);
    if (pathname === "api/team_search") {
      const { name } = req.query;
      const smLeagueId = name ? (CLUB_LEAGUE_MAP[name] ?? 301) : 301;
      const teams = await getTeamsByLeague(smLeagueId);
      const resolvedId = name ? await resolveTeamId(name) : null;
      return res.status(200).json({
        resolvedId,
        smLeagueId,
        count: teams.length,
        teams: teams.sort((a,b) => (a.name ?? "").localeCompare(b.name ?? "")),
      });
    }
    if (pathname === "api/competitions_global") return handleCompetitionsGlobal(req, res);
    if (pathname === "api/stadiums_global")    return await handleStadiumsGlobal(req, res);

    return res.status(404).json({
      error: "Route not found",
      path: pathname,
      available: [
        "/api/matches_global",
        "/api/livescores",
        "/api/team_history",
        "/api/leagues",
        "/api/competitions_global",
        "/api/stadiums_global",
      ],
    });
  } catch (err) {
    console.error(`[${pathname}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
