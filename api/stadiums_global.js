// /api/stadiums_global.js
export default async function handler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const minCapacity = Math.max(parseInt(req.query.minCapacity || "5000", 10), 0);

    const sparql = `
SELECT ?stadium ?stadiumLabel ?capacity ?lat ?lon ?countryLabel WHERE {
  ?stadium wdt:P31/wdt:P279* wd:Q483110 .   # stade (inclut sous-classes)
  OPTIONAL { ?stadium wdt:P1083 ?capacity . }
  OPTIONAL { ?stadium wdt:P625 ?coord . }
  OPTIONAL { ?stadium wdt:P17 ?country . }

  FILTER(BOUND(?coord))
  FILTER(!BOUND(?capacity) || ?capacity > ${minCapacity})

  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)

  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
LIMIT ${limit}
OFFSET ${offset}
    `.trim();

    const url =
      "https://query.wikidata.org/sparql?format=json&query=" +
      encodeURIComponent(sparql);

    const r = await fetch(url, {
      headers: {
        "Accept": "application/sparql-results+json",
        // User-Agent recommandé par Wikidata
        "User-Agent": "Grounder/1.0 (contact: you@example.com)",
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "WIKIDATA_FETCH_FAILED", status: r.status, text });
    }

    const data = await r.json();
    const rows = data.results.bindings;

    const stadiums = rows.map((b) => ({
      id: b.stadium?.value || null, // URL Wikidata
      name: b.stadiumLabel?.value || null,
      capacity: b.capacity ? Number(b.capacity.value) : null,
      lat: b.lat ? Number(b.lat.value) : null,
      lon: b.lon ? Number(b.lon.value) : null,
      country: b.countryLabel?.value || null,
      source: "wikidata",
    }));

    // Cache CDN Vercel (stale-while-revalidate)
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");

    res.status(200).json({
      buildTag: "STADIUMS_GLOBAL_WD_V1",
      limit,
      offset,
      count: stadiums.length,
      stadiums,
      usage: {
        examples: [
          "/api/stadiums_global?limit=200",
          "/api/stadiums_global?limit=200&offset=200",
          "/api/stadiums_global?minCapacity=15000",
        ],
      },
    });
  } catch (e) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: String(e) });
  }
}
