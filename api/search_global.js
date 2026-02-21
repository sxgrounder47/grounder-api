module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(200).json({ q, teams: [], leagues: [] });

    const [teams, leagues] = await Promise.all([tsdbSearchTeams(q), tsdbSearchLeagues(q)]);

    return res.status(200).json({ q, teamsCount: teams.length, leaguesCount: leagues.length, teams, leagues });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e) });
  }
};

async function tsdbSearchTeams(q) {
  const key = process.env.THESPORTSDB_API_KEY || "1";
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/searchteams.php?t=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = await r.json();
  const teams = data.teams || [];
  return teams.map((t) => ({
    id: `TSDBTEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || t.strTeam || null,
    badge: t.strTeamBadge || null,
    country: t.strCountry || null,
    league: t.strLeague || null,
    stadium: t.strStadium || null
  }));
}

async function tsdbSearchLeagues(q) {
  const key = process.env.THESPORTSDB_API_KEY || "1";
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/search_all_leagues.php?l=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = await r.json();
  const leagues = data.countrys || []; // oui c'est leur nom de champ…
  return leagues
    .filter((l) => (l.strSport || "").toLowerCase() === "soccer")
    .map((l) => ({
      id: `TSDB:${l.idLeague}`,
      source: "thesportsdb",
      name: l.strLeague || null,
      country: l.strCountry || null
    }));
}
