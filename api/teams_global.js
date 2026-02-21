module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const buildTag = "TEAMS_GLOBAL_V3_BADGES_REQUIRED";

  try {
    const leagueId = String(req.query.leagueId || "").trim(); // ex: TSDB:4328 or FD:2021
    if (!leagueId) {
      return res.status(400).json({
        buildTag,
        error: "Missing leagueId. Example: ?leagueId=TSDB:4328",
      });
    }

    const [src, rawId] = leagueId.split(":");
    if (!src || !rawId) {
      return res.status(400).json({
        buildTag,
        error: "Invalid leagueId format. Use TSDB:xxxx or FD:xxxx",
      });
    }

    let teams = [];
    if (src === "TSDB") {
      teams = await fetchTSDBTeamsWithBadges(rawId);
    } else if (src === "FD") {
      teams = await fetchFDTeams(rawId);
    } else {
      return res.status(400).json({
        buildTag,
        error: "Unknown source. Use TSDB:xxxx or FD:xxxx",
      });
    }

    return res.status(200).json({
      buildTag,
      leagueId,
      count: teams.length,
      teams,
    });
  } catch (e) {
    return res.status(500).json({
      buildTag,
      error: "Server error",
      message: String(e),
    });
  }
};

async function fetchTSDBTeamsWithBadges(idLeague) {
  const key = process.env.THESPORTSDB_API_KEY || "1";

  // 1) base list
  const r = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${idLeague}`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const teams = data.teams || [];

  // 2) normalize
  const base = teams.map((t) => ({
    id: `TSDB_TEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || null,
    country: t.strCountry || null,
    badge: null, // will be filled
  }));

  // 3) enrich badges with controlled concurrency
  const CONCURRENCY = 4; // safe for free key + vercel runtime
  const ids = base.map((t) => t.id.split(":")[1]);

  const badgeMap = new Map();

  await runPool(ids, CONCURRENCY, async (teamId) => {
    const badge = await fetchTSDBBadge(teamId, key);
    badgeMap.set(teamId, badge);
  });

  // 4) merge (badge required -> if missing, use fallback computed url null)
  for (const t of base) {
    const teamId = t.id.split(":")[1];
    t.badge = badgeMap.get(teamId) || null;
  }

  return base;
}

async function fetchTSDBBadge(teamId, key) {
  try {
    const rr = await fetch(
      `https://www.thesportsdb.com/api/v1/json/${key}/lookupteam.php?id=${teamId}`
    );
    if (!rr.ok) return null;

    const dd = await rr.json();
    const detail = dd.teams?.[0];
    return detail?.strTeamBadge || null;
  } catch {
    return null;
  }
}

// simple concurrency pool
async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function fetchFDTeams(competitionId) {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) return [];

  const r = await fetch(
    `https://api.football-data.org/v4/competitions/${competitionId}/teams`,
    { headers: { "X-Auth-Token": token } }
  );
  if (!r.ok) return [];

  const data = await r.json();
  const teams = data.teams || [];
  return teams.map((t) => ({
    id: `FD_TEAM:${t.id}`,
    source: "football-data",
    name: t.name || null,
    shortName: t.shortName || null,
    country: t.area?.name || null,
    crest: t.crest || null, // already includes logo
  }));
}
