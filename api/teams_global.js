export default async function handler(req, res) {
  try {
    const leagueId = (req.query.leagueId || "").trim();
    if (!leagueId) {
      return res.status(400).json({
        ok: false,
        error: "Missing leagueId. Example: /api/teams_global?leagueId=FD:2021 or TSDB:4328",
      });
    }

    const fdKey = process.env.FOOTBALL_DATA_API_KEY || "";
    const tsdbKey = process.env.THESPORTSDB_API_KEY || "";

    // Optional: allow forcing source
    const source = (req.query.source || "").trim().toLowerCase(); // "football-data" | "thesportsdb" | ""

    let payload;
    if (leagueId.startsWith("FD:") && (source === "" || source === "football-data")) {
      payload = await getTeamsFromFootballData({ leagueId, fdKey });
    } else if (leagueId.startsWith("TSDB:") && (source === "" || source === "thesportsdb")) {
      payload = await getTeamsFromTheSportsDB({
        leagueId,
        tsdbKey,
        fdKey, // for best-effort FD crest match
        enrichWithFdCrests: true,
        enrichLimit: 12, // ⚠️ to avoid spamming FD API
      });
    } else {
      // If prefix unknown, try to infer
      if (source === "football-data") payload = await getTeamsFromFootballData({ leagueId: `FD:${leagueId}`, fdKey });
      else if (source === "thesportsdb") payload = await getTeamsFromTheSportsDB({ leagueId: `TSDB:${leagueId}`, tsdbKey, fdKey, enrichWithFdCrests: true, enrichLimit: 12 });
      else {
        return res.status(400).json({
          ok: false,
          error: "Unknown leagueId prefix. Use FD:<id> or TSDB:<id>.",
        });
      }
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "teams_global crashed",
      detail: String(err?.message || err),
    });
  }
}

/** ---------------------------
 *  FOOTBALL-DATA
 *  ---------------------------
 */
async function getTeamsFromFootballData({ leagueId, fdKey }) {
  const id = leagueId.replace("FD:", "");
  if (!fdKey) throw new Error("Missing FOOTBALL_DATA_API_KEY");

  const url = `https://api.football-data.org/v4/competitions/${encodeURIComponent(id)}/teams`;
  const data = await fetchJson(url, {
    headers: { "X-Auth-Token": fdKey },
  });

  const teams = (data?.teams || []).map((t) => ({
    id: `FD_TEAM:${t.id}`,
    source: "football-data",
    name: t.name || null,
    shortName: t.shortName || t.tla || null,
    country: t.area?.name || null,
    badge: normalizeFdCrest(t.crest),
  }));

  // guarantee badge non-null (best UX)
  const safeTeams = teams.map((t) => ({
    ...t,
    badge: t.badge || fallbackBadge(t.name),
  }));

  return {
    buildTag: "TEAMS_GLOBAL_BEST_V1",
    leagueId,
    count: safeTeams.length,
    teams: safeTeams,
  };
}

function normalizeFdCrest(crest) {
  // FD sometimes returns .svg / .png, we keep as-is
  if (!crest) return null;
  return crest;
}

/** ---------------------------
 *  THESPORTSDB + BEST-EFFORT FD CREST MATCH
 *  ---------------------------
 */
async function getTeamsFromTheSportsDB({
  leagueId,
  tsdbKey,
  fdKey,
  enrichWithFdCrests = true,
  enrichLimit = 12,
}) {
  const id = leagueId.replace("TSDB:", "");
  if (!tsdbKey) throw new Error("Missing THESPORTSDB_API_KEY");

  const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(tsdbKey)}/lookup_all_teams.php?id=${encodeURIComponent(id)}`;
  const data = await fetchJson(url);

  let teams = (data?.teams || []).map((t) => ({
    id: `TSDB_TEAM:${t.idTeam}`,
    source: "thesportsdb",
    name: t.strTeam || null,
    shortName: t.strTeamShort || t.strTeam || null,
    country: t.strCountry || null,
    badge: normalizeTsdbBadge(t.strTeamBadge),
  }));

  // Step 1: If TSDB badge missing, set placeholder first (never null)
  teams = teams.map((t) => ({
    ...t,
    badge: t.badge || fallbackBadge(t.name),
  }));

  // Step 2 (best effort): replace placeholder by REAL FD crest if possible (limited calls)
  if (enrichWithFdCrests && fdKey) {
    // Only try on teams that still have placeholder (meaning TSDB had no badge)
    const need = teams
      .filter((t) => isPlaceholderBadge(t.badge))
      .slice(0, enrichLimit);

    if (need.length > 0) {
      const crestMap = await fetchFdCrestsByTeamNameBatch(need.map((t) => t.name).filter(Boolean), fdKey);

      teams = teams.map((t) => {
        if (!t.name) return t;
        const crest = crestMap.get(normalizeName(t.name));
        if (crest) return { ...t, badge: crest };
        return t;
      });
    }
  }

  return {
    buildTag: "TEAMS_GLOBAL_BEST_V1",
    leagueId,
    count: teams.length,
    teams,
  };
}

function normalizeTsdbBadge(badgeUrl) {
  if (!badgeUrl) return null;
  return badgeUrl;
}

/** ---------------------------
 *  FD crest search by team name (limited)
 *  ---------------------------
 */
async function fetchFdCrestsByTeamNameBatch(teamNames, fdKey) {
  // We use FD /teams?name=... (best effort). If FD doesn’t support some names, it returns empty.
  // We do one request per team name (limited by enrichLimit).
  const map = new Map();

  for (const name of teamNames) {
    const clean = (name || "").trim();
    if (!clean) continue;

    const url = `https://api.football-data.org/v4/teams?name=${encodeURIComponent(clean)}`;
    try {
      const data = await fetchJson(url, { headers: { "X-Auth-Token": fdKey } });
      const team = (data?.teams || [])[0];
      const crest = normalizeFdCrest(team?.crest);
      if (crest) {
        map.set(normalizeName(clean), crest);
      }
    } catch (e) {
      // ignore (best effort)
    }
  }
  return map;
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/fc\b/g, "")
    .replace(/cf\b/g, "")
    .replace(/afc\b/g, "")
    .replace(/the\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** ---------------------------
 *  Utilities
 *  ---------------------------
 */
async function fetchJson(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Fetch failed ${r.status} ${r.statusText} - ${text.slice(0, 200)}`);
  }
  return r.json();
}

function fallbackBadge(teamName) {
  const name = teamName || "Club";
  const encoded = encodeURIComponent(name);
  // Nice, stable, free placeholder
  return `https://ui-avatars.com/api/?name=${encoded}&background=111827&color=ffffff&size=256&bold=true&format=png`;
}

function isPlaceholderBadge(url) {
  return typeof url === "string" && url.includes("ui-avatars.com/api");
}
