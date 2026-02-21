module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = process.env.FOOTBALL_DATA_API_KEY;
    if (!token) return res.status(500).json({ error: "Missing FOOTBALL_DATA_API_KEY env var" });

    const r = await fetch("https://api.football-data.org/v4/competitions", {
      headers: { "X-Auth-Token": token },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: "Football-Data.org error", details: txt });
    }

    const data = await r.json();
    const competitions = (data.competitions || []).map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code || null,
      type: c.type || null,
      country: c.area?.name || null,
    }));

    return res.status(200).json({ count: competitions.length, competitions });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};
