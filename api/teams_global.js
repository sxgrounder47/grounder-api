module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const buildTag = "TEAMS_GLOBAL_V2_SAFE";

  try {
    const leagueId = String(req.query.leagueId || "").trim();
    const withBadges = String(req.query.withBadges || "0") === "1";
    const badgeLimit = Math.min(Number(req.query.badgeLimit || 10), 25); // max 25

    if (!leagueId) {
      return res.status(400).json({
        buildTag,
        error: "Missing leagueId. Example: ?leagueId=TSDB:4328"
      });
    }

    const [src, rawId] = leagueId.split(":");
    if (!src || !rawId) {
      return res.status(400).json({
        buildTag,
        error: "Invalid leagueId format. Use TSDB:xxxx or FD:xxxx"
      });
    }

    if (src === "TSDB") {
      const teams = await fetchTSDBTeams(rawId, { withBadges, badgeLimit });
      return res.status(200).json({ buildTag, leagueId, count: teams.length, teams });
    }

    if (src === "FD") {
      const teams = await fetchFDTeams(rawId);
      return res.status(200).json({ buildTag, leagueId, count: teams.length, teams });
    }

    return res.status(400).json({ buildTag, error: "Unknown source. Use TSDB:xxxx or FD:xxxx" });
  } catch (e) {
    return res.status(500).json({ buildTag, error: "Server error", message: String(e) });
  }
};

async function fetchTSDBTeams(idLeague, opts) {
  const key = process.env.THESPORTSDB_API_KEY || "1";
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${idLeague}`);
  if (!r.ok) return [];
  const data = await r.json();
  const teams = data.teams || [];

  // base list (rapide)
  const base = teams.map(t => ({
    id: `TSDB_TEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || null,
    country: t.strCountry || null,
    badge: null
  }));

  // si pas demandé -> on renvoie direct
  if (!opts.withBadges) return base;

  // badges seulement sur les N premières équipes (anti-timeout)
  const slice = base.slice(0, opts.badgeLimit);

  for (let i = 0; i < slice.length; i++) {
    const teamId = slice[i].id.split(":")[1];
    try {
      const rr = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/lookupteam.php?id=${teamId}`);
      if (!rr.ok) continue;
      const dd = await rr.json();
      const detail = dd.teams?.[0];
      slice[i].badge = detail?.strTeamBadge || null;
    } catch (_) {
      // on ignore, no crash
    }
  }

  return base;
}

async function fetchFDTeams(competitionId) {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];
  const r = await fetch(`https://api.football-data.org/v4/competitions/${competitionId}/teams`, {
    headers: { "X-Auth-Token": token }
  });
  if (!r.ok) return [];
  const data = await r.json();
  const teams = data.teams || [];
  return teams.map(t => ({
    id: `FD_TEAM:${t.id}`,
    source: "football-data",
    name: t.name || null,
    shortName: t.shortName || null,
    country: t.area?.name || null,
    crest: t.crest || null
  }));
}
