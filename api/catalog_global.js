// api/catalog_global.js
export default async function handler(req, res) {
  try {
    const source = (req.query.source || "all").toLowerCase(); // all | football-data | thesportsdb
    const country = req.query.country ? String(req.query.country).toLowerCase() : null;
    const type = req.query.type ? String(req.query.type).toUpperCase() : null; // LEAGUE | CUP

    const fdKey = process.env.FOOTBALL_DATA_API_KEY;
    const tsdbKey = process.env.THESPORTSDB_API_KEY;

    // petit helper fetch safe
    async function safeFetchJson(url, opts = {}) {
      const r = await fetch(url, opts);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
      if (!r.ok) {
        const err = new Error(`HTTP ${r.status} on ${url}`);
        err.details = data;
        throw err;
      }
      return data;
    }

    // ---------- Football-Data.org ----------
    async function getFootballDataCompetitions() {
      if (!fdKey) return { count: 0, items: [], warning: "FOOTBALL_DATA_API_KEY missing" };

      // endpoint standard: /v4/competitions
      const data = await safeFetchJson("https://api.football-data.org/v4/competitions", {
        headers: { "X-Auth-Token": fdKey },
      });

      const competitions = Array.isArray(data?.competitions) ? data.competitions : [];

      const items = competitions.map((c) => ({
        id: `FD:${c.id}`,
        source: "football-data",
        name: c.name || null,
        code: c.code || null,
        type: (c.type || "LEAGUE").toUpperCase(), // LEAGUE | CUP
        country: c.area?.name || null,
        countryCode: c.area?.code || null,
        emblem: c.emblem || null,
        seasonStart: c.currentSeason?.startDate || null,
        seasonEnd: c.currentSeason?.endDate || null,
      }));

      return { count: items.length, items };
    }

    // ---------- TheSportsDB ----------
    async function getTSDBLeagues() {
      if (!tsdbKey) return { count: 0, items: [], warning: "THESPORTSDB_API_KEY missing" };

      // all_leagues.php renvoie une liste énorme (ligues, cups, etc.)
      const data = await safeFetchJson(
        `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(tsdbKey)}/all_leagues.php`
      );

      const leagues = Array.isArray(data?.leagues) ? data.leagues : [];

      const items = leagues.map((l) => ({
        id: `TSDB:${l.idLeague}`,
        source: "thesportsdb",
        name: l.strLeague || null,
        // TSDB a strSport (on veut que "Soccer")
        sport: l.strSport || null,
        // TSDB a parfois "strLeagueAlternate"
        altName: l.strLeagueAlternate || null,
        // Country pas toujours dispo sur all_leagues -> on laisse null ici (on peut enrichir + tard)
        country: null,
        type: (l.strLeague && l.strLeague.toLowerCase().includes("cup")) ? "CUP" : "LEAGUE",
        code: null,
        emblem: null,
      }))
      // garde uniquement foot (soccer)
      .filter((x) => (x.sport || "").toLowerCase() === "soccer")
      .map(({ sport, ...rest }) => rest);

      return { count: items.length, items };
    }

    // ---------- Run ----------
    const tasks = [];
    if (source === "all" || source === "football-data") tasks.push(getFootballDataCompetitions());
    if (source === "all" || source === "thesportsdb") tasks.push(getTSDBLeagues());

    const results = await Promise.all(tasks);

    const merged = results.flatMap((r) => r.items || []);

    // filtres optionnels
    let filtered = merged;

    if (country) {
      filtered = filtered.filter((x) => (x.country || "").toLowerCase().includes(country));
    }
    if (type) {
      filtered = filtered.filter((x) => (x.type || "") === type);
    }

    // tri “propre”
    filtered.sort((a, b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    // cache léger (évite spam)
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    return res.status(200).json({
      buildTag: "CATALOG_GLOBAL_V1",
      count: filtered.length,
      sources: {
        footballData: results.find((r) => r?.items?.[0]?.id?.startsWith("FD:"))?.count ?? 0,
        theSportsDB: results.find((r) => r?.items?.[0]?.id?.startsWith("TSDB:"))?.count ?? 0,
      },
      competitions: filtered,
      usage: {
        examples: [
          "/api/catalog_global",
          "/api/catalog_global?source=football-data",
          "/api/catalog_global?source=thesportsdb",
          "/api/catalog_global?type=CUP",
        ],
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Unknown error",
      details: e.details || null,
    });
  }
}
