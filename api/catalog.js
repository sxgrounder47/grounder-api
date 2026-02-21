module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Lire le JSON local (stocké dans le repo)
    const catalog = require("../data/openfootball_catalog.json");

    // Optionnel: filtrage simple
    const q = (req.query.q || "").toLowerCase().trim();
    if (!q) {
      return res.status(200).json({ ok: true, count: catalog.length, items: catalog });
    }

    const filtered = catalog.filter((x) => {
      const hay = `${x.country} ${x.league} ${x.team}`.toLowerCase();
      return hay.includes(q);
    });

    return res.status(200).json({ ok: true, count: filtered.length, items: filtered });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};
