module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const buildTag = "LEAGUES_GLOBAL_V3";

  try {
    const limit = Math.min(Number(req.query.limit || 500), 2000);

    const [fd, tsdb] = await Promise.allSettled([
      fetchFDCompetitions(),
      fetchTSDBAllLeagues(limit)
    ]);

    const fdItems = fd.status === "fulfilled" ? fd.value : [];
    const tsdbItems = tsdb.status === "fulfilled" ? tsdb.value : [];

    const merged = dedupeLeagues([...fdItems, ...tsdbItems]);

    return res.status(200).json({
      buildTag,
      count: merged.length,
      sources: {
        footballData: fdItems.length,
        theSportsDB: tsdbItems.length
      },
      leagues: merged
    });

  } catch (e) {
    return res.status(500).json({
      buildTag,
      error: "Server error",
      message: String(e)
    });
  }
};

/* ---------- FOOTBALL DATA ---------- */

async function fetchFDCompetitions() {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];

  const r = await fetch("https://api.football-data.org/v4/competitions", {
    headers: { "X-Auth-Token": token }
  });

  if (!r.ok) return [];

  const data = await r.json();

  return (data.competitions || []).map(c => ({
    id: `FD:${c.id}`,
    source: "football-data",
    name: c.name || null,
    country: c.area?.name || null,
    type: c.type || null,
    code: c.code || null
  }));
}

/* ---------- THESPORTSDB SIMPLE ---------- */

async function fetchTSDBAllLeagues(limit) {
  const key = process.env.THESPORTSDB_API_KEY || "1";

  const r = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${key}/all_leagues.php`
  );

  if (!r.ok) return [];

  const data = await r.json();
  const leagues = data.leagues || [];

  return leagues
    .filter(l => (l.strSport || "").toLowerCase() === "soccer")
    .slice(0, limit)
    .map(l => ({
      id: `TSDB:${l.idLeague}`,
      source: "thesportsdb",
      name: l.strLeague || null,
      country: l.strCountry || null,
      type: "LEAGUE",
      code: null
    }));
}

/* ---------- DEDUPE ---------- */

function dedupeLeagues(items) {
  const map = new Map();

  for (const x of items) {
    const key = `${(x.country || "").toLowerCase()}|${(x.name || "").toLowerCase()}`;
    if (!map.has(key)) map.set(key, x);
  }

  return Array.from(map.values());
}
