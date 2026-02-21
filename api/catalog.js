// api/catalog.js
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Tu pourras changer ça quand tu auras choisi EXACTEMENT quel JSON OpenFootball utiliser
    // (pays, ligues, clubs, etc.)
    const url =
      req.query.url ||
      process.env.OPENFOOTBALL_CATALOG_URL ||
      "";

    if (!url) {
      return res.status(200).json({
        ok: true,
        message:
          "Set OPENFOOTBALL_CATALOG_URL (or pass ?url=...) to a raw JSON file from OpenFootball.",
        example:
          "GET /api/catalog?url=<RAW_JSON_URL>",
      });
    }

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: "OpenFootball fetch failed", details: txt });
    }

    const data = await r.json();
    return res.status(200).json({ ok: true, sourceUrl: url, data });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};
