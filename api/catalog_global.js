export default async function handler(req, res) {
  try {
    const buildTag = "CATALOG_GLOBAL_ALL_V1";

    const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_API_KEY;
    const TSDB_KEY = process.env.THESPORTSDB_API_KEY;

    const wantSource = (req.query.source || "all").toLowerCase(); // all | football-data | thesportsdb
    const wantType = (req.query.type || "all").toUpperCase();     // all | LEAGUE | CUP
    const q = (req.query.q || "").toLowerCase();                  // search text
    const limit = Math.min(parseInt(req.query.limit || "500", 10), 2000);

    // ---------------- helpers ----------------
    function normalize(str) {
      return (str || "")
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, "") // accents (basic)
        .replace(/[^a-z0-9]+/g, "")
        .trim();
    }

    function guessType(name) {
      const n = (name || "").toLowerCase();
      if (
        n.includes("cup") ||
        n.includes("copa") ||
        n.includes("coupe") ||
        n.includes("pokalen") ||
        n.includes("pokal") ||
        n.includes("coppa") ||
        n.includes("taça") ||
        n.includes("taca") ||
        n.includes("knockout")
      ) return "CUP";
      return "LEAGUE";
    }

    // ---------------- fetch football-data ----------------
    let fdData = [];
    if ((wantSource === "all" || wantSource === "football-data") && FOOTBALL_DATA_KEY) {
      const fdUrl = "https://api.football-data.org/v4/competitions";
      const r = await fetch(fdUrl, {
        headers: { "X-Auth-Token": FOOTBALL_DATA_KEY },
      });

      if (r.ok) {
        const json = await r.json();
        fdData = (json.competitions || []).map((c) => ({
          id: `FD:${c.id}`,
          source: "football-data",
          name: c.name || null,
          code: c.code || null,
          type: (c.type || null)?.toUpperCase() || guessType(c.name),
          country: c.area?.name || null,
          countryCode: c.area?.code || null,
          emblem: c.emblem || null,
          seasonStart: c.currentSeason?.startDate || null,
          seasonEnd: c.currentSeason?.endDate || null,
        }));
      }
    }

    // ---------------- fetch theSportsDB (ALL soccer leagues) ----------------
    let tsdbData = [];
    if ((wantSource === "all" || wantSource === "thesportsdb") && TSDB_KEY) {
      // all soccer leagues/cups
      const tsdbUrl = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}/all_leagues.php?s=Soccer`;
      const r = await fetch(tsdbUrl);

      if (r.ok) {
        const json = await r.json();
        tsdbData = (json.leagues || []).map((l) => ({
          id: `TSDB:${l.idLeague}`,
          source: "thesportsdb",
          name: l.strLeague || null,
          code: null,
          type: guessType(l.strLeague),
          country: null,
          countryCode: null,
          emblem: null,
          seasonStart: null,
          seasonEnd: null,
        }));
      }
    }

    // ---------------- merge + dedupe ----------------
    const fdNames = fdData.map((x) => normalize(x.name));
    const cleanTsdb = tsdbData.filter((t) => {
      const tn = normalize(t.name);
      // keep if no "close match" exists in FD
      return !fdNames.some((fn) => tn.includes(fn) || fn.includes(tn));
    });

    let merged = [...fdData, ...cleanTsdb];

    // ---------------- filters ----------------
    if (wantType !== "ALL") {
      merged = merged.filter((x) => (x.type || "").toUpperCase() === wantType);
    }

    if (q) {
      merged = merged.filter((x) => (x.name || "").toLowerCase().includes(q));
    }

    // stable sort
    merged.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // limit
    merged = merged.slice(0, limit);

    // sources count
    const sources = {
      footballData: fdData.length,
      theSportsDB: cleanTsdb.length,
    };

    return res.status(200).json({
      buildTag,
      count: merged.length,
      sources,
      competitions: merged,
      usage: {
        examples: [
          "/api/catalog_global",
          "/api/catalog_global?source=thesportsdb",
          "/api/catalog_global?type=CUP",
          "/api/catalog_global?q=cup",
          "/api/catalog_global?limit=200",
        ],
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "CATALOG_GLOBAL_ERROR",
      message: e?.message || String(e),
    });
  }
}
