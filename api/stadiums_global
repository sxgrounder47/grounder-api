// api/stadiums_global.js
// Endpoint : GET /api/stadiums_global
//
// Paramètres optionnels :
//   ?country=FR          → filtre par code pays ISO 2 (ex: FR, DE, ES, GB, BR)
//   ?minCapacity=10000   → capacité minimale (défaut: 5000)
//   ?limit=200           → nombre max de résultats (défaut: 500, max: 1000)
//
// Source : Wikidata SPARQL (gratuit, sans clé API)
// Cache : 24h (les stades ne changent pas souvent)

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

// Map ISO 2 → Wikidata country QID
const COUNTRY_QID = {
  FR: "Q142",  DE: "Q183",  ES: "Q29",   GB: "Q145",
  IT: "Q38",   PT: "Q45",   NL: "Q55",   BE: "Q31",
  BR: "Q155",  AR: "Q414",  MX: "Q96",   US: "Q30",
  JP: "Q17",   CN: "Q148",  KR: "Q884",  AU: "Q408",
  NG: "Q1033", ZA: "Q258",  EG: "Q79",   MA: "Q1028",
  SA: "Q851",  TR: "Q43",   RU: "Q159",  UA: "Q212",
  PL: "Q36",   CZ: "Q213",  RO: "Q218",  GR: "Q41",
  SE: "Q34",   NO: "Q20",   DK: "Q35",   CH: "Q39",
  AT: "Q40",   HR: "Q224",  RS: "Q403",  CO: "Q739",
  CL: "Q298",  PE: "Q419",  UY: "Q77",   EC: "Q736",
};

function buildQuery(countryCode, minCapacity, limit) {
  const capacityFilter = `FILTER(?capacity >= ${minCapacity})`;
  const countryFilter = countryCode && COUNTRY_QID[countryCode]
    ? `?stadium wdt:P17 wd:${COUNTRY_QID[countryCode]} .`
    : `OPTIONAL { ?stadium wdt:P17 ?country }`;

  return `
    SELECT DISTINCT
      ?stadium
      ?stadiumLabel
      ?capacity
      ?lat
      ?lon
      ?countryLabel
      ?image
      ?clubLabel
    WHERE {
      ?stadium wdt:P31 wd:Q483110 .
      ?stadium wdt:P1083 ?capacity .
      ?stadium wdt:P625 ?coord .
      BIND(geof:latitude(?coord)  AS ?lat)
      BIND(geof:longitude(?coord) AS ?lon)
      ${countryFilter}
      OPTIONAL {
        ?club wdt:P115 ?stadium .
        ?club wdt:P31  wd:Q476028 .
      }
      OPTIONAL { ?stadium wdt:P18 ?image }
      ${capacityFilter}
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "fr,en"
      }
    }
    ORDER BY DESC(?capacity)
    LIMIT ${limit}
  `;
}

function normalizeStadium(binding) {
  const wikidataId = binding.stadium?.value?.split("/entity/")[1] || null;

  // Thumbnail Wikimedia si image disponible
  let thumbnail = null;
  if (binding.image?.value) {
    const filename = binding.image.value.split("/Special:FilePath/")[1];
    if (filename) {
      thumbnail = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=400`;
    }
  }

  return {
    id:           `WD:${wikidataId}`,
    wikidataId,
    name:         binding.stadiumLabel?.value || "Stade inconnu",
    capacity:     parseInt(binding.capacity?.value) || 0,
    lat:          parseFloat(binding.lat?.value) || null,
    lon:          parseFloat(binding.lon?.value) || null,
    country:      binding.countryLabel?.value || null,
    club:         binding.clubLabel?.value || null,
    thumbnail,
    source:       "wikidata",
  };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Params
  const country     = (req.query.country || "").toUpperCase() || null;
  const minCapacity = parseInt(req.query.minCapacity) || 5000;
  const limit       = Math.min(parseInt(req.query.limit) || 500, 1000);

  // Validation
  if (country && !COUNTRY_QID[country]) {
    return res.status(400).json({
      error: `Code pays inconnu : ${country}. Codes supportés : ${Object.keys(COUNTRY_QID).join(", ")}`,
    });
  }

  try {
    const query = buildQuery(country, minCapacity, limit);
    const url   = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;

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

    // Déduplications par wikidataId (une entrée par stade)
    const seen    = new Set();
    const stadiums = [];

    for (const binding of bindings) {
      const wikidataId = binding.stadium?.value?.split("/entity/")[1];
      if (!wikidataId || seen.has(wikidataId)) continue;
      seen.add(wikidataId);

      const stadium = normalizeStadium(binding);
      // Garder uniquement les stades avec coordonnées valides
      if (stadium.lat && stadium.lon) {
        stadiums.push(stadium);
      }
    }

    // Cache 24h côté CDN Vercel
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");

    return res.status(200).json({
      count:   stadiums.length,
      source:  "wikidata",
      filters: { country: country || "all", minCapacity, limit },
      stadiums,
    });

  } catch (err) {
    console.error("[stadiums_global] Error:", err.message);
    return res.status(500).json({
      error:   "Erreur lors de la requête Wikidata",
      details: err.message,
    });
  }
}
