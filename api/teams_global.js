module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const buildTag = "TEAMS_GLOBAL_CLEAN_V1";

  try {
    const leagueId = String(req.query.leagueId || "").trim(); // ex: TSDB:4328 ou FD:2021
    if (!leagueId) {
      return res.status(400).json({
        buildTag,
        error: "Missing leagueId",
        example: "/api/teams_global?leagueId=TSDB:4328",
      });
    }

    const [source, rawId] = leagueId.split(":");
    if (!source || !rawId) {
      return res.status(400).json({
        buildTag,
        error: "Invalid leagueId format",
        example: "/api/teams_global?leagueId=TSDB:4328",
      });
    }

    if (source === "TSDB") {
      const teams = await getTeamsFromTSDB(rawId);
      return res.status(200).json({
        buildTag,
        leagueId,
        count: teams.length,
        teams,
      });
    }

    if (source === "FD") {
      const teams = await getTeamsFromFootballData(rawId);
      return res.status(200).json({
        buildTag,
        leagueId,
        count: teams.length,
        teams,
      });
    }

    return res.status(400).json({
      buildTag,
      error: "Unknown source (use TSDB or FD)",
      example: "/api/teams_global?leagueId=TSDB:4328",
    });
  } catch (e) {
    // important: renvoyer l’erreur lisible (sinon tu comprends rien)
    return res.status(500).json({
      buildTag,
      error: "Server error",
      message: String(e?.message || e),
    });
  }
};

async function getTeamsFromTSDB(idLeague) {
  const key = process.env.THESPORTSDB_API_KEY || "123";

  const url = `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${idLeague}`;
  const r = await fetch(url);

  if (!r.ok) return [];
  const data = await r.json();
  const teams = data?.teams || [];

  return teams.map((t) => ({
    id: `TSDB_TEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || null,
    country: t.strCountry || null,
    badge: t.strTeamBadge || null, // ✅ LOGO DIRECT ICI
  }));
}

async function getTeamsFromFootballData(competitionId) {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];

  const r = await fetch(
    `https://api.football-data.org/v4/competitions/${competitionId}/teams`,
    { headers: { "X-Auth-Token": token } }
  );

  if (!r.ok) return [];
  const data = await r.json();
  const teams = data?.teams || [];

  return teams.map((t) => ({
    id: `FD_TEAM:${t.id}`,
    source: "football-data",
    name: t.name || null,
    shortName: t.shortName || null,
    country: t.area?.name || null,
    badge: t.crest || null, // logo
  }));
}
