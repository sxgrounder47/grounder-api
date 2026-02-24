/**
 * Grounder API — /api/leagues (Sportmonks v3)
 *
 * Retourne les ligues disponibles dans l'abonnement avec leurs IDs Sportmonks.
 * Utile pour vérifier le mapping FD → Sportmonks IDs.
 */

const SM_TOKEN = process.env.SPORTMONKS_TOKEN || "ZCYsAeTUx6YP8phj1J0QsWL9ErxXmDl1DhKS6GfAXu3xyQBpXWguhyZG1aYH";
const SM_BASE  = "https://api.sportmonks.com/v3/football";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const url = new URL(`${SM_BASE}/leagues`);
    url.searchParams.set("api_token", SM_TOKEN);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("select", "id,name,short_code,image_path,country_id");

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).json({ error: txt });
    }

    const data = await upstream.json();
    const leagues = (data.data ?? []).map(l => ({
      id:         l.id,
      name:       l.name,
      short_code: l.short_code ?? null,
      logo:       l.image_path ?? null,
      country_id: l.country_id ?? null,
    }));

    res.setHeader("Cache-Control", "public, s-maxage=86400");
    return res.status(200).json({ leagues });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
