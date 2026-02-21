module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const limit = Math.min(Number(req.query.limit || 300), 2000); // sécurité
    const country = (req.query.country || "").trim(); // optionnel: "France", "England", etc.

    const [fd, tsdb] = await Promise.allSettled([
      fetchFDCompetitions(),
      fetchTSDBLeaguesWorld({ country, limit }),
    ]);

    const fdItems = fd.status === "fulfilled" ? fd.value : [];
    const tsdbItems = tsdb.status === "fulfilled" ? tsdb.value : [];

    const merged = dedupeLeagues([...fdItems, ...tsdbItems]);

    return res.status(200).json({
      count: merged.length,
      sources: { footballData: fdItems.length, theSportsDB: tsdbItems.length },
      leagues: merged,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};

// ---------- FOOTBALL-DATA ----------
async function fetchFDCompetitions() {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];
  const r = await fetch("https://api.football-data.org/v4/competitions", {
    headers: { "X-Auth-Token": token },
  });
  if (!r.ok) return [];
  const data = await r.json();

  return (data.competitions || []).map((c) => ({
    id: `FD:${c.id}`,
    source: "football-data",
    name: c.name || null,
    country: c.area?.name || null,
    type: c.type || null,
    code: c.code || null,
  }));
}

// ---------- THESPORTSDB (WORLD) ----------
async function fetchTSDBLeaguesWorld({ country, limit }) {
  const key = process.env.THESPORTSDB_API_KEY || "1";

  // Si un pays est demandé -> direct
  if (country) {
    const leagues = await tsdbLeaguesByCountry(key, country);
    return leagues.slice(0, limit);
  }

  // Sinon, on récupère la liste des pays, puis on récupère les ligues par pays (plus fiable)
  const countries = await tsdbCountries(key);

  const out = [];
  for (const c of countries) {
    const leagues = await tsdbLeaguesByCountry(key, c);
    for (const l of leagues) {
      out.push(l);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

async function tsdbCountries(key) {
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/all_countries.php`);
  if (!r.ok) return [];
  const data = await r.json();
  const countries = data.countries || [];
  // on renvoie juste les noms de pays
  return countries
    .map((x) => x.name)
    .filter(Boolean);
}

async function tsdbLeaguesByCountry(key, country) {
  const r = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${key}/search_all_leagues.php?c=${encodeURIComponent(
      country
    )}&s=Soccer`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const leagues = data.countrys || [];
  return leagues
    .filter((l) => (l.strSport || "").toLowerCase() === "soccer")
    .map((l) => ({
      id: `TSDB:${l.idLeague}`,
      source: "thesportsdb",
      name: l.strLeague || null,
      country: l.strCountry || country || null,
      type: "LEAGUE",
      code: null,
    }));
}

function dedupeLeagues(items) {
  const map = new Map();
  for (const x of items) {
    const key = `${(x.country || "").toLowerCase()}|${(x.name || "").toLowerCase()}`;
    if (!map.has(key)) map.set(key, x);
  }
  return Array.from(map.values());
}
