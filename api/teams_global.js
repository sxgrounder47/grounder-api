async function fetchTSDBTeamsWithBadges(idLeague) {
  const key = process.env.THESPORTSDB_API_KEY || "123";

  const r = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${idLeague}`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const teams = data.teams || [];

  // IMPORTANT: le badge est déjà là -> strTeamBadge
  return teams.map((t) => ({
    id: `TSDB_TEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || null,
    country: t.strCountry || null,
    badge: t.strTeamBadge || null, // ✅ LOGO DIRECT
  }));
}
