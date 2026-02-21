module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const id = req.query.id;
    const source = (req.query.source || "").toLowerCase();

    if (!id || !source) {
      return res.status(400).json({ error: "Missing id or source. Example: /api/league_teams?id=4328&source=thesportsdb" });
    }

    if (source === "thesportsdb") {
      const teams = await tsdbTeamsByLeague(id);
      return res.status(200).json({ source, leagueId: id, count: teams.length, teams });
    }

    // Football-Data free ne donne pas facilement "teams by competition" sans endpoints payants selon cas.
    // Donc on renvoie un message clair.
    if (source === "football-data") {
      return res.status(200).json({
        source,
        leagueId: id,
        count: 0,
        teams: [],
        note: "Football-Data free has limited team listing endpoints. Use TheSportsDB for league->teams in V1."
      });
    }

    return res.status(400).json({ error: "Invalid source. Use 'thesportsdb' or 'football-data'." });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};

async function tsdbTeamsByLeague(idLeague) {
  const key = process.env.THESPORTSDB_API_KEY || "1";
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${encodeURIComponent(idLeague)}`);
  if (!r.ok) return [];
  const data = await r.json();
  const teams = data.teams || [];
  return teams.map((t) => ({
    id: `TSDBTEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || t.strTeam || null,
    badge: t.strTeamBadge || null,
    stadium: t.strStadium || null
  }));
}
