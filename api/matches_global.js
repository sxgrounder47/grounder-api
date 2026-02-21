// api/matches_global.js

function send(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  // CORS simple
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.end(JSON.stringify(payload));
}

function normalizeDateInput(dateStr) {
  // attendu: YYYY-MM-DD
  if (!dateStr || typeof dateStr !== "string") return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  return ok ? dateStr : null;
}

function parseCompetitionId(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Exemple: "FD:2021" / "TSDB:4332"
  const [source, id] = raw.split(":");
  if (!source || !id) return null;
  const s = source.trim().toUpperCase();
  const i = id.trim();
  if (s !== "FD" && s !== "TSDB") return null;
  return { source: s, id: i, raw: `${s}:${i}` };
}

function pickQueryParam(req) {
  // on accepte plusieurs noms pour éviter les galères
  return (
    req.query.competitionId ||
    req.query.leagueId ||
    req.query.competition ||
    req.query.id ||
    null
  );
}

/**
 * FOOTBALL-DATA (v4)
 * GET /v4/competitions/{id}/matches?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 */
async function fetchFootballDataMatches({ competitionIdNumber, date }) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error("Missing env FOOTBALL_DATA_API_KEY");

  const url = `https://api.football-data.org/v4/competitions/${competitionIdNumber}/matches?dateFrom=${date}&dateTo=${date}`;

  const r = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`football-data error ${r.status}: ${txt.slice(0, 200)}`);
  }

  const data = await r.json();

  // data.matches[]
  const matches = (data.matches || []).map((m) => ({
    id: `FD_MATCH:${m.id}`,
    source: "football-data",
    utcDate: m.utcDate,
    status: m.status,
    competition: {
      id: String(m.competition?.id ?? competitionIdNumber),
      name: m.competition?.name ?? null,
      country: m.area?.name ?? null,
    },
    homeTeam: {
      id: String(m.homeTeam?.id ?? ""),
      name: m.homeTeam?.name ?? null,
      shortName: m.homeTeam?.shortName ?? null,
      logo: m.homeTeam?.crest ?? null,
    },
    awayTeam: {
      id: String(m.awayTeam?.id ?? ""),
      name: m.awayTeam?.name ?? null,
      shortName: m.awayTeam?.shortName ?? null,
      logo: m.awayTeam?.crest ?? null,
    },
    score: {
      home: m.score?.fullTime?.home ?? null,
      away: m.score?.fullTime?.away ?? null,
    },
    venue: {
      name: m.venue ?? null,
      city: null,
      gps: null,
    },
  }));

  return matches;
}

/**
 * THESPORTSDB
 * eventsday.php donne tous les events du jour pour un sport.
 * On filtre ensuite par idLeague si on veut une compétition spécifique.
 */
async function fetchTheSportsDbMatches({ date, tsdbLeagueId = null }) {
  const apiKey = process.env.THESPORTSDB_API_KEY; // sur ton screen ta key = "123"
  if (!apiKey) throw new Error("Missing env THESPORTSDB_API_KEY");

  // Soccer / Football
  const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsday.php?d=${date}&s=Soccer`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`thesportsdb error ${r.status}: ${txt.slice(0, 200)}`);
  }

  const data = await r.json();
  let events = data?.events || [];

  if (tsdbLeagueId) {
    events = events.filter((e) => String(e.idLeague) === String(tsdbLeagueId));
  }

  const matches = events.map((e) => ({
    id: `TSDB:${e.idEvent}`,
    source: "thesportsdb",
    utcDate: e.strTimestamp ? new Date(e.strTimestamp).toISOString() : null,
    status: e.strStatus || "SCHEDULED",
    competition: {
      id: String(e.idLeague || ""),
      name: e.strLeague || null,
      country: e.strCountry || null,
    },
    homeTeam: {
      id: String(e.idHomeTeam || ""),
      name: e.strHomeTeam || null,
      shortName: e.strHomeTeam || null,
      logo: null,
    },
    awayTeam: {
      id: String(e.idAwayTeam || ""),
      name: e.strAwayTeam || null,
      shortName: e.strAwayTeam || null,
      logo: null,
    },
    score: {
      home: e.intHomeScore != null ? Number(e.intHomeScore) : null,
      away: e.intAwayScore != null ? Number(e.intAwayScore) : null,
    },
    venue: {
      name: e.strVenue || null,
      city: null,
      gps: null,
    },
  }));

  return matches;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });

  try {
    const date = normalizeDateInput(req.query.date) || normalizeDateInput(req.query.d);
    if (!date) {
      return send(res, 400, {
        ok: false,
        error: "Missing/invalid date. Use ?date=YYYY-MM-DD",
        example: "/api/matches_global?competitionId=FD:2021&date=2026-02-21",
      });
    }

    const rawComp = pickQueryParam(req);
    const parsed = parseCompetitionId(rawComp);

    // CASE 1: competitionId fourni et valide
    if (parsed?.source === "FD") {
      const competitionIdNumber = parsed.id; // ex: 2021
      const matches = await fetchFootballDataMatches({ competitionIdNumber, date });

      return send(res, 200, {
        buildTag: "MATCHES_GLOBAL_ROUTED_V1",
        date,
        sources: { footballData: matches.length, theSportsDB: 0 },
        count: matches.length,
        matches,
      });
    }

    if (parsed?.source === "TSDB") {
      const tsdbLeagueId = parsed.id; // ex: 4332
      const matches = await fetchTheSportsDbMatches({ date, tsdbLeagueId });

      return send(res, 200, {
        buildTag: "MATCHES_GLOBAL_ROUTED_V1",
        date,
        sources: { footballData: 0, theSportsDB: matches.length },
        count: matches.length,
        matches,
      });
    }

    // CASE 2: pas de competitionId (ou invalide) -> fallback TSDB du jour (tout Soccer)
    const matches = await fetchTheSportsDbMatches({ date, tsdbLeagueId: null });

    return send(res, 200, {
      buildTag: "MATCHES_GLOBAL_FALLBACK_TSDB_V1",
      date,
      sources: { footballData: 0, theSportsDB: matches.length },
      count: matches.length,
      matches,
      usage: {
        examples: [
          `/api/matches_global?competitionId=FD:2021&date=${date}`,
          `/api/matches_global?competitionId=TSDB:4332&date=${date}`,
          `/api/matches_global?date=${date}`,
        ],
      },
    });
  } catch (err) {
    console.error("matches_global error:", err);
    return send(res, 500, {
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
      message: err?.message || String(err),
    });
  }
};
