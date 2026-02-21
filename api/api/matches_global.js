// api/matches_global.js
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [fd, tsdb] = await Promise.allSettled([
      fetchFootballData(date),
      fetchTheSportsDB(date),
    ]);

    const fdMatches = fd.status === "fulfilled" ? fd.value : [];
    const tsdbMatches = tsdb.status === "fulfilled" ? tsdb.value : [];

    // Merge + dedupe
    const merged = dedupeMatches([...fdMatches, ...tsdbMatches]);

    return res.status(200).json({
      date,
      sources: {
        footballData: fdMatches.length,
        theSportsDB: tsdbMatches.length,
      },
      count: merged.length,
      matches: merged,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};

// ---------- FOOTBALL-DATA.ORG ----------
async function fetchFootballData(date) {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];

  const url = `https://api.football-data.org/v4/matches?dateFrom=${date}&dateTo=${date}`;
  const r = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!r.ok) return [];

  const data = await r.json();
  return (data.matches || []).map((m) => ({
    id: `FD:${m.id}`,
    source: "football-data",
    utcDate: m.utcDate,
    status: m.status,
    competition: {
      id: m.competition?.id ?? null,
      name: m.competition?.name ?? null,
      country: m.area?.name ?? null,
    },
    homeTeam: {
      id: m.homeTeam?.id ?? null,
      name: m.homeTeam?.name ?? null,
      shortName: m.homeTeam?.shortName || m.homeTeam?.tla || m.homeTeam?.name || null,
      logo: null,
    },
    awayTeam: {
      id: m.awayTeam?.id ?? null,
      name: m.awayTeam?.name ?? null,
      shortName: m.awayTeam?.shortName || m.awayTeam?.tla || m.awayTeam?.name || null,
      logo: null,
    },
    score: {
      home: m.score?.fullTime?.home ?? null,
      away: m.score?.fullTime?.away ?? null,
    },
    venue: {
      name: m.venue || null,
      city: null,
      gps: null,
    },
  }));
}

// ---------- THESPORTSDB ----------
async function fetchTheSportsDB(date) {
  // TheSportsDB: tu peux utiliser la clé "1" (dev/public),
  // mais l'idéal est de créer une clé gratuite perso et la mettre ici.
  const key = process.env.THESPORTSDB_API_KEY || "1";

  // Soccer day events
  const url = `https://www.thesportsdb.com/api/v1/json/${key}/eventsday.php?d=${date}&s=Soccer`;
  const r = await fetch(url);
  if (!r.ok) return [];

  const data = await r.json();
  const events = data.events || [];
  return events.map((e) => ({
    id: `TSDB:${e.idEvent}`,
    source: "thesportsdb",
    utcDate: e.dateEvent && e.strTime ? `${e.dateEvent}T${normalizeTime(e.strTime)}Z` : null,
    status: normalizeTSDBStatus(e.strStatus),
    competition: {
      id: e.idLeague || null,
      name: e.strLeague || null,
      country: e.strCountry || null,
    },
    homeTeam: {
      id: e.idHomeTeam || null,
      name: e.strHomeTeam || null,
      shortName: e.strHomeTeam || null,
      logo: null,
    },
    awayTeam: {
      id: e.idAwayTeam || null,
      name: e.strAwayTeam || null,
      shortName: e.strAwayTeam || null,
      logo: null,
    },
    score: {
      home: isNum(e.intHomeScore) ? Number(e.intHomeScore) : null,
      away: isNum(e.intAwayScore) ? Number(e.intAwayScore) : null,
    },
    venue: {
      name: e.strVenue || null,
      city: null,
      gps: null,
    },
  }));
}

function dedupeMatches(matches) {
  // Dédup simple par “date + home + away”
  const map = new Map();
  for (const m of matches) {
    const d = (m.utcDate || "").slice(0, 10);
    const h = (m.homeTeam?.name || "").toLowerCase().trim();
    const a = (m.awayTeam?.name || "").toLowerCase().trim();
    const key = `${d}|${h}|${a}`;

    if (!map.has(key)) {
      map.set(key, m);
    } else {
      // on garde celui qui a un score ou une date plus précise
      const prev = map.get(key);
      const prevHasScore = prev?.score?.home != null || prev?.score?.away != null;
      const currHasScore = m?.score?.home != null || m?.score?.away != null;

      if (!prevHasScore && currHasScore) map.set(key, m);
      if (!prev.utcDate && m.utcDate) map.set(key, m);
    }
  }
  return Array.from(map.values());
}

function normalizeTSDBStatus(s) {
  if (!s) return "SCHEDULED";
  const x = s.toLowerCase();
  if (x.includes("finished") || x.includes("ft")) return "FINISHED";
  if (x.includes("live") || x.includes("in progress")) return "LIVE";
  return "SCHEDULED";
}

function normalizeTime(t) {
  // t peut être "19:45:00" ou "19:45"
  if (!t) return "00:00:00";
  return t.length === 5 ? `${t}:00` : t;
}

function isNum(v) {
  return v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));
}
