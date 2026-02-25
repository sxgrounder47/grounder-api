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
  let { teamId, team, dateFrom, dateTo, startDate, endDate, page = "1" } = req.query;

  // Compatibilité anciens params
  dateFrom = dateFrom ?? startDate;
  dateTo   = dateTo   ?? endDate;

  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: "Missing dateFrom/dateTo" });
  }

  // Résoudre l'ID si on a un nom
  if (!teamId && team) {
    teamId = await resolveTeamId(team);
    if (!teamId) {
      return res.status(404).json({ error: `Team not found: ${team}` });
    }
  }

  if (!teamId) {
    return res.status(400).json({ error: "Missing teamId or team name" });
  }

  // Sportmonks limite à 100 jours — on splitte en chunks de 90j et on appelle en parallèle
  const chunks = [];
  let cursor = new Date(dateFrom);
  const endDateObj = new Date(dateTo);
  while (cursor < endDateObj) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 89);
    if (chunkEnd > endDateObj) chunkEnd.setTime(endDateObj.getTime());
    chunks.push([cursor.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10)]);
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  const chunkResults = await Promise.all(chunks.map(async ([from, to]) => {
    const u = new URL(`${SM_BASE}/fixtures/between/${from}/${to}`);
    u.searchParams.set("api_token", SM_TOKEN);
    u.searchParams.set("filters", `teamId:${teamId}`);
    u.searchParams.set("include", "participants;scores;state;league");
    u.searchParams.set("per_page", "100");
    u.searchParams.set("sort", "desc");
    const r = await fetch(u.toString());
    if (!r.ok) {
      if (r.status === 404) return [];
      throw new Error(`${r.status}: ${await r.text()}`);
    }
    const d = await r.json();
    return d.data ?? [];
  }));

  const fixtures = chunkResults.flat();

  const matches = fixtures.map(f => {
    const participants = f.participants ?? [];
    const home = participants.find(p => p.meta?.location === "home");
    const away = participants.find(p => p.meta?.location === "away");
    const scores = extractScores(f.scores ?? []);
    const stateId = f.state?.id ?? f.state_id ?? null;
    const status  = mapState(stateId);

    let result = null;
    const isHome = home?.id === Number(teamId);
    if (scores.fullTime.home !== null && scores.fullTime.away !== null) {
      const goalsFor     = isHome ? scores.fullTime.home : scores.fullTime.away;
      const goalsAgainst = isHome ? scores.fullTime.away : scores.fullTime.home;
      result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
    }

    return {
      id:      f.id,
      utcDate: f.starting_at ? new Date(f.starting_at).toISOString() : null,
      status,
      competition: { id: `SM:${f.league_id}`, name: f.league?.name ?? null },
      homeTeam: {
        id:    home?.id ?? null,
        name:  home?.name ?? "?",
        tla:   home?.short_code ?? null,
        crest: home?.image_path ?? null,
      },
      awayTeam: {
        id:    away?.id ?? null,
        name:  away?.name ?? "?",
        tla:   away?.short_code ?? null,
        crest: away?.image_path ?? null,
      },
      score: {
        fullTime: { home: scores.fullTime.home, away: scores.fullTime.away },
        halfTime: { home: scores.halfTime.home, away: scores.halfTime.away },
      },
      result,
    };
  });

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  return res.status(200).json({
    matches,
    teamId: Number(teamId),
    hasMore: false,
    page: Number(page),
  });
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
