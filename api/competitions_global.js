// /api/competitions_global.js
export default async function handler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    // Compétitions de football : on récupère les ligues / compétitions
    const sparql = `
SELECT ?comp ?compLabel ?countryLabel WHERE {
  ?comp wdt:P31/wdt:P279* wd:Q27020041 .  # compétition sportive (football leagues/cups)
  OPTIONAL { ?comp wdt:P17 ?country . }

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
        "User-Agent": "Grounder/1.0 (contact: you@example.com)",
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "WIKIDATA_FETCH_FAILED", status: r.status, text });
    }

    const data = await r.json();
    const rows = data.results.bindings;

    const competitions = rows.map((b) => ({
      id: b.comp?.value || null,
      name: b.compLabel?.value || null,
      country: b.countryLabel?.value || null,
      source: "wikidata",
    }));

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");

    res.status(200).json({
      buildTag: "COMPETITIONS_GLOBAL_WD_V1",
      limit,
      offset,
      count: competitions.length,
      competitions,
      usage: {
        examples: [
          "/api/competitions_global?limit=200",
          "/api/competitions_global?limit=200&offset=200",
        ],
      },
    });
  } catch (e) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: String(e) });
  }
}
