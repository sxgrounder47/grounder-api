/**
 * Vercel Edge Function — /api/crest
 * Proxies Football-Data.org crest images to bypass CORS/hotlink protection
 * Usage: /api/crest?url=https://crests.football-data.org/...
 */
export default async function handler(req, res) {
  const { url } = req.query;
  if (!url || !url.startsWith("https://crests.football-data.org/")) {
    return res.status(400).json({ error: "Invalid URL" });
  }
  try {
    const upstream = await fetch(url, {
      headers: {
        "Referer": "https://www.football-data.org/",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).end();
    }
    const buffer = await upstream.arrayBuffer();
    const ct = upstream.headers.get("content-type") ?? "image/png";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
