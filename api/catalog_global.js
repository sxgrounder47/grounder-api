// api/catalog_global.js

export default async function handler(req, res) {
  try {
    const source = (req.query.source || "all").toLowerCase();
    const country = req.query.country ? String(req.query.country).toLowerCase() : null;
    const type = req.query.type ? String(req.query.type).toUpperCase() : null;

    const fdKey = process.env.FOOTBALL_DATA_API_KEY;
    const tsdbKey = process.env.THESPORTSDB_API_KEY;

    async function safeFetch(url, options = {}) {
      const r = await fetch(url, options);
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} - ${url}`);
      }
      return data;
    }

    // ---------------- FOOTBALL-DATA ----------------
    async function getFootballData() {
      if (!fdKey) return [];

      const data = await safeFetch(
        "https://api.football-data.org/v4/competitions",
        { headers: { "X-Auth-Token": fdKey } }
      );

      const competitions = Array.isArray(data?.competitions)
        ? data.competitions
        : [];

      return competitions.map((c) => ({
        id: `FD:${c.id}`,
        source: "football-data",
        name: c.name || null,
        code: c.code || null,
        type: (c.type || "LEAGUE").toUpperCase(),
        country: c.area?.name || null,
        countryCode: c.area?.code || null,
        emblem: c.emblem || null,
        seasonStart: c.currentSeason?.startDate || null,
        seasonEnd: c.currentSeason?.endDate || null,
      }));
    }

    // ---------------- THESPORTSDB ----------------
    async function getTSDB() {
      if (!tsdbKey) return [];

      const data = await safeFetch(
        `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(
          tsdbKey
        )}/all_leagues.php`
      );

      const leagues = Array.isArray(data?.leagues) ? data.leagues : [];

      return leagues
        .filter((l) => (l.strSport || "").toLowerCase() === "soccer")
        .map((l) => ({
          id: `TSDB:${l.idLeague}`,
          source: "thesportsdb",
          name: l.strLeague || null,
          code: null,
          type:
            (l.strLeague || "").toLowerCase().includes("cup")
              ? "CUP"
              : "LEAGUE",
          country: null,
          countryCode: null,
          emblem: null,
          seasonStart: null,
          seasonEnd: null,
        }));
    }

    // ---------------- FETCH DATA ----------------
    const fdData =
      source === "all" || source === "football-data"
        ? await getFootballData()
        : [];

    const tsdbData =
      source === "all" || source === "thesportsdb"
        ? await getTSDB()
        : [];

   // -------- SMART DEDUP --------

// on crée une liste des noms FD normalisés
const fdNames = fdData.map((x) => (x.name || "").toLowerCase());

// fonction simple de normalisation
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/league/g, "")
    .replace(/fc/g, "")
    .replace(/serie/g, "")
    .replace(/liga/g, "")
    .replace(/\s+/g, "")
    .trim();
}

// on garde TSDB seulement si aucun nom FD ne correspond "à peu près"
const cleanTsdb = tsdbData.filter((tsdb) => {
  const tsName = normalize(tsdb.name);

  return !fdNames.some((fdName) => {
    const fdNorm = normalize(fdName);
    return tsName.includes(fdNorm) || fdNorm.includes(tsName);
  });
});

let merged = [...fdData, ...cleanTsdb];

    // ---------------- FILTERS ----------------
    if (country) {
      merged = merged.filter((x) =>
        (x.country || "").toLowerCase().includes(country)
      );
    }

    if (type) {
      merged = merged.filter((x) => x.type === type);
    }

    // ---------------- SORT ----------------
    merged.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );

    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      buildTag: "CATALOG_GLOBAL_CLEAN_V1",
      count: merged.length,
      sources: {
        footballData: fdData.length,
        theSportsDB: cleanTsdb.length,
      },
      competitions: merged,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
