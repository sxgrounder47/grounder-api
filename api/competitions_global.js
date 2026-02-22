// api/competitions_global.js
// Endpoint : GET /api/competitions_global
//
// Paramètres optionnels :
//   ?country=FR          → filtre par code pays ISO 2
//   ?confederation=UEFA  → UEFA | CONMEBOL | CAF | AFC | CONCACAF | OFC
//   ?tier=1              → niveau (1 = première division, 2 = deuxième, etc.)
//
// Source : Wikidata SPARQL — complète Football-Data (13 compétitions)
//          avec une couverture mondiale exhaustive
// Cache : 7 jours

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

const COUNTRY_QID = {
  FR: "Q142",  DE: "Q183",  ES: "Q29",   GB: "Q145",
  IT: "Q38",   PT: "Q45",   NL: "Q55",   BE: "Q31",
  BR: "Q155",  AR: "Q414",  MX: "Q96",   US: "Q30",
  JP: "Q17",   CN: "Q148",  KR: "Q884",  AU: "Q408",
  NG: "Q1033", ZA: "Q258",  EG: "Q79",   MA: "Q1028",
  SA: "Q851",  TR: "Q43",   RU: "Q159",  PL: "Q36",
  SE: "Q34",   NO: "Q20",   DK: "Q35",   CH: "Q39",
  AT: "Q40",   HR: "Q224",  CO: "Q739",  CL: "Q298",
  NG: "Q1033", GH: "Q117",  SN: "Q1041", CI: "Q1008",
};

// QIDs Wikidata des confédérations
const CONFEDERATION_QID = {
  UEFA:     "Q14552",
  CONMEBOL: "Q170521",
  CAF:      "Q191296",
  AFC:      "Q161609",
  CONCACAF: "Q170524",
  OFC:      "Q179970",
};

// Compétitions Football-Data déjà connues — on les inclut quand même
// pour avoir un référentiel unifié, mais on les marque comme "enrichies"
const FOOTBALL_DATA_IDS = {
  "Ligue 1":            "FD:2015",
  "Bundesliga":         "FD:2002",
  "La Liga":            "FD:2014",
  "Serie A":            "FD:2019",
  "Premier League":     "FD:2021",
  "Eredivisie":         "FD:2003",
  "Primeira Liga":      "FD:2017",
  "Championship":       "FD:2016",
  "Champions League":   "FD:2001",
  "Europa League":      "FD:2146",
  "World Cup":          "FD:2000",
  "European Championship": "FD:2018",
  "Copa Libertadores":  "FD:2152",
};

function buildQuery(countryCode, confederationCode, tier) {
  const countryFilter = countryCode && COUNTRY_QID[countryCode]
    ? `?competition wdt:P17 wd:${COUNTRY_QID[countryCode]} .`
    : `OPTIONAL { ?competition wdt:P17 ?country }`;

  const confFilter = confederationCode && CONFEDERATION_QID[confederationCode]
    ? `?competition wdt:P576 wd:${CONFEDERATION_QID[confederationCode]} .`
    : "";

  const tierFilter = tier
    ? `?competition wdt:P2522 "${tier}"^^xsd:integer .`
    : `OPTIONAL { ?competition wdt:P2522 ?tier }`;

  return `
    SELECT DISTINCT
      ?competition
      ?competitionLabel
      ?countryLabel
      ?confederationLabel
      ?logo
      ?tier
      ?teams
    WHERE {
      VALUES ?types {
        wd:Q15991303   # ligue de football
        wd:Q15900926   # compétition de football association
        wd:Q2312440    # saison de ligue de football
      }
      ?competition wdt:P31/wdt:P279* ?types .
      ${countryFilter}
      ${confFilter}
      ${tierFilter}
      OPTIONAL { ?competition wdt:P154 ?logo }
      OPTIONAL { ?competition wdt:P1132 ?teams }
      FILTER NOT EXISTS { ?competition wdt:P576 ?endDate }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "fr,en"
      }
    }
    ORDER BY ?countryLabel ?tier ?competitionLabel
    LIMIT 800
  `;
}

function normalizeCompetition(binding) {
  const wikidataId = binding.competition?.value?.split("/entity/")[1] || null;
  const name       = binding.competitionLabel?.value || "Compétition inconnue";

  // Associer un ID Football-Data si on connaît cette compétition
  const fdId = FOOTBALL_DATA_IDS[name] || null;

  // Logo Wikimedia si disponible
  let logoUrl = null;
  if (binding.logo?.value) {
    const filename = binding.logo.value.split("/Special:FilePath/")[1];
    if (filename) {
      logoUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=200`;
    }
  }

  return {
    id:            fdId || `WD:${wikidataId}`,
    wikidataId,
    footballDataId: fdId,
    name,
    country:       binding.countryLabel?.value || null,
    confederation: binding.confederationLabel?.value || null,
    tier:          binding.tier?.value ? parseInt(binding.tier.value) : null,
    teamsCount:    binding.teams?.value ? parseInt(binding.teams.value) : null,
    logo:          logoUrl,
    source:        fdId ? "wikidata+football-data" : "wikidata",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const country       = (req.query.country || "").toUpperCase() || null;
  const confederation = (req.query.confederation || "").toUpperCase() || null;
  const tier          = parseInt(req.query.tier) || null;

  if (country && !COUNTRY_QID[country]) {
    return res.status(400).json({
      error: `Code pays inconnu : ${country}`,
      supported: Object.keys(COUNTRY_QID),
    });
  }

  if (confederation && !CONFEDERATION_QID[confederation]) {
    return res.status(400).json({
      error: `Confédération inconnue : ${confederation}`,
      supported: Object.keys(CONFEDERATION_QID),
    });
  }

  try {
    const query    = buildQuery(country, confederation, tier);
    const url      = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;

    const response = await fetch(url, {
      headers: {
        "Accept":     "application/sparql-results+json",
        "User-Agent": "GrounderApp/1.0 (https://grounder-api.vercel.app)",
      },
    });

    if (!response.ok) {
      throw new Error(`Wikidata SPARQL error: ${response.status}`);
    }

    const data     = await response.json();
    const bindings = data?.results?.bindings || [];

    const seen         = new Set();
    const competitions = [];

    for (const binding of bindings) {
      const wikidataId = binding.competition?.value?.split("/entity/")[1];
      if (!wikidataId || seen.has(wikidataId)) continue;
      seen.add(wikidataId);

      const comp = normalizeCompetition(binding);
      // Ignorer les entrées sans nom utile
      if (comp.name && !comp.name.startsWith("Q")) {
        competitions.push(comp);
      }
    }

    // Regrouper par pays pour faciliter l'usage côté app
    const byCountry = {};
    for (const comp of competitions) {
      const key = comp.country || "International";
      if (!byCountry[key]) byCountry[key] = [];
      byCountry[key].push(comp);
    }

    // Cache 7 jours
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");

    return res.status(200).json({
      count:       competitions.length,
      source:      "wikidata",
      filters:     { country: country || "all", confederation: confederation || "all", tier },
      byCountry,
      competitions,
    });

  } catch (err) {
    console.error("[competitions_global] Error:", err.message);
    return res.status(500).json({
      error:   "Erreur lors de la requête Wikidata",
      details: err.message,
    });
  }
}
