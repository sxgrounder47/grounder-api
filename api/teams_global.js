async function fetchTSDBTeams(idLeague) {
  const key = process.env.THESPORTSDB_API_KEY || "1";

  // 1️⃣ Récupérer les équipes
  const r = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${idLeague}`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const teams = data.teams || [];

  // 2️⃣ Pour chaque équipe → récupérer logo via lookupteam
  const detailedTeams = await Promise.all(
    teams.map(async (t) => {
      const detailRes = await fetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookupteam.php?id=${t.idTeam}`
      );
      if (!detailRes.ok) return null;

      const detailData = await detailRes.json();
      const detail = detailData.teams?.[0];

      return {
        id: `TSDB_TEAM:${t.idTeam}`,
        source: "thesportsdb",
        name: t.strTeam || null,
        shortName: t.strTeamShort || null,
        country: t.strCountry || null,
        badge: detail?.strTeamBadge || null,
        stadium: detail?.strStadium || null
      };
    })
  );

  return detailedTeams.filter(Boolean);
}
