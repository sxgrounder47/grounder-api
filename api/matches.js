module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const token = process.env.FOOTBALL_DATA_API_KEY;
    if (!token) {
      return res.status(500).json({ error: "Missing FOOTBALL_DATA_API_KEY env var" });
    }

    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const url = `https://api.football-data.org/v4/matches?dateFrom=${date}&dateTo=${date}`;

    const r = await fetch(url, {
      headers: { "X-Auth-Token": token },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: "Football-Data.org error", details: txt });
    }

    const data = await r.json();

    const matches = (data.matches || []).map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      competition: {
        id: m.competition?.id,
        name: m.competition?.name,
        country: m.area?.name,
      },
      homeTeam: {
        id: m.homeTeam?.id,
        name: m.homeTeam?.name,
        shortName: m.homeTeam?.shortName || m.homeTeam?.tla || m.homeTeam?.name,
      },
      awayTeam: {
        id: m.awayTeam?.id,
        name: m.awayTeam?.name,
        shortName: m.awayTeam?.shortName || m.awayTeam?.tla || m.awayTeam?.name,
      },
      score: {
        home: m.score?.fullTime?.home ?? null,
        away: m.score?.fullTime?.away ?? null,
      },
      venue: {
        name: m.venue || null,
      },
    }));

    return res.status(200).json({ date, count: matches.length, matches });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};
