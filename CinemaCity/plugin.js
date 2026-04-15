(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────────
  // MANIFEST  (must be defined before any usage)
  // ─────────────────────────────────────────────────────────────────────────────
  const manifest = {
    name: "CinemaCity",
    packageName: "com.phisher98.cinemacity",
    version: 1,
    baseUrl: "https://cinemacity.cc",
    description:
      "CinemaCity – Movies & TV Series with Cinemeta metadata. Ported from CloudStream (phisher98).",
    authors: ["phisher98", "ported"],
    languages: ["en"],
    categories: ["Movie", "TvSeries"],
    iconUrl: "https://cinemacity.cc/favicon.ico",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────
  const BASE_URL = manifest.baseUrl;
  const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
  const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
  const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

  // Cookie decoded from base64 in the original Kotlin:
  //   base64Decode("ZGxlX3VzZXJfaWQ9MzI3Mjk7IGRsZV9wYXNzd29yZD04OTQxNzFjNmE4ZGFiMThlZTU5NGQ1YzY1MjAwOWEzNTs=")
  //   => "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;"
  const SITE_COOKIE =
    "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;";

  const HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Cookie: SITE_COOKIE,
    Referer: BASE_URL + "/",
    "Accept-Language": "en-US,en;q=0.9",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // HOME PAGE CATEGORIES  (mirrors Kotlin mainPageOf)
  // ─────────────────────────────────────────────────────────────────────────────
  const HOME_CATEGORIES = [
    { path: "movies", name: "Trending" },         // reserved → hero carousel
    { path: "tv-series", name: "TV Series" },
    { path: "xfsearch/genre/anime", name: "Anime" },
    { path: "xfsearch/genre/asian", name: "Asian" },
    { path: "xfsearch/genre/animation", name: "Animation" },
    { path: "xfsearch/genre/documentary", name: "Documentary" },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────────

  function b64decode(str) {
    try { return atob(str); } catch (e) { return ""; }
  }

  function decodeEntities(str) {
    if (!str) return "";
    return str
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  }

  function fixUrl(href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return BASE_URL + href;
    return BASE_URL + "/" + href;
  }

  async function fetchPage(url, extraHeaders = {}) {
    const resp = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
    const text = await resp.text();
    return { text, ok: resp.ok, status: resp.status };
  }

  async function fetchJson(url) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": HEADERS["User-Agent"], Accept: "application/json" },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) { return null; }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTML PARSING HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  function parseListingHtml(html) {
    const items = [];
    const linkRegex =
      /<a\s+href="(https:\/\/cinemacity\.cc\/(?:movies|tv-series)\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    const posterRegex =
      /<a\s+href="(https:\/\/cinemacity\.cc\/uploads\/[^"]+)"[^>]*data-highslide[^>]*>/g;

    const links = [];
    const posters = [];
    let m;

    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1];
      const rawTitle = decodeEntities(m[2].trim());
      if (rawTitle.length < 3) continue;
      links.push({ href, rawTitle });
    }

    while ((m = posterRegex.exec(html)) !== null) {
      posters.push(m[1]);
    }

    const count = Math.min(links.length, posters.length);
    for (let i = 0; i < count; i++) {
      const { href, rawTitle } = links[i];
      const posterUrl = posters[i] || "";
      const title = rawTitle.replace(/\s*\(\d{4}[^)]*\)\s*$/, "").trim() || rawTitle;
      const yearMatch = rawTitle.match(/\((\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
      const type = href.includes("/tv-series/") ? "series" : "movie";
      items.push(new MultimediaItem({ title, url: href, posterUrl, type, year }));
    }
    return items;
  }

  function parseSubtitles(raw) {
    if (!raw) return [];
    const tracks = [];
    for (const part of raw.split(",")) {
      const m = part.trim().match(/^\[(.+?)](https?:\/\/.+)$/);
      if (m) tracks.push({ language: m[1], subtitleUrl: m[2] });
    }
    return tracks;
  }

  function extractQuality(url) {
    if (!url) return "Unknown";
    if (url.includes("2160p")) return "4K";
    if (url.includes("1440p")) return "1440p";
    if (url.includes("1080p")) return "1080p";
    if (url.includes("720p")) return "720p";
    if (url.includes("480p")) return "480p";
    if (url.includes("360p")) return "360p";
    return "HD";
  }

  function extractPlayerData(html) {
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    const atobScripts = [];
    let sm;
    while ((sm = scriptPattern.exec(html)) !== null) {
      if (sm[1].includes("atob(")) atobScripts.push(sm[1]);
    }
    if (atobScripts.length === 0) return null;

    const candidates = atobScripts.length >= 2 ? [atobScripts[1]] : [atobScripts[0]];
    for (const scriptContent of [...candidates, ...atobScripts]) {
      try {
        const b64Match = scriptContent.match(/atob\(["']([A-Za-z0-9+/=]+)["']\)/);
        if (!b64Match) continue;
        const decoded = b64decode(b64Match[1]);
        if (!decoded) continue;
        const pjStart = decoded.indexOf("new Playerjs(");
        if (pjStart === -1) continue;
        const jsonStart = decoded.indexOf("{", pjStart);
        if (jsonStart === -1) continue;
        let depth = 0, jsonEnd = -1;
        for (let i = jsonStart; i < decoded.length; i++) {
          if (decoded[i] === "{") depth++;
          else if (decoded[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
        }
        if (jsonEnd === -1) continue;
        return JSON.parse(decoded.substring(jsonStart, jsonEnd + 1));
      } catch (_) {}
    }
    return null;
  }

  function parsePlayerStreams(playerJson) {
    const result = { streams: [], subtitles: [] };
    if (!playerJson) return result;
    if (typeof playerJson.subtitle === "string")
      result.subtitles.push(...parseSubtitles(playerJson.subtitle));
    const rawFile = playerJson.file;
    if (!rawFile) return result;
    let fileArray;
    try {
      if (Array.isArray(rawFile)) fileArray = rawFile;
      else if (typeof rawFile === "string") {
        const t = rawFile.trim();
        if (t.startsWith("[")) fileArray = JSON.parse(t);
        else if (t.startsWith("{")) fileArray = [JSON.parse(t)];
        else if (t.startsWith("http")) { result.streams.push({ url: t, quality: extractQuality(t) }); return result; }
      }
    } catch (_) {
      if (typeof rawFile === "string" && rawFile.startsWith("http"))
        result.streams.push({ url: rawFile, quality: extractQuality(rawFile) });
      return result;
    }
    if (!fileArray) return result;
    for (const item of fileArray) {
      if (item && !item.folder && item.file && item.file.startsWith("http"))
        result.streams.push({ url: item.file, quality: extractQuality(item.file) });
    }
    return result;
  }

  function parseSeriesEpisodes(playerJson) {
    const episodes = [];
    if (!playerJson) return episodes;
    let fileArray;
    try {
      const rawFile = playerJson.file;
      if (Array.isArray(rawFile)) fileArray = rawFile;
      else if (typeof rawFile === "string") fileArray = JSON.parse(rawFile.trim());
      else return episodes;
    } catch (_) { return episodes; }

    const seasonRegex = /Season\s*(\d+)/i;
    const episodeRegex = /Episode\s*(\d+)/i;

    for (const seasonObj of fileArray) {
      if (!seasonObj?.folder) continue;
      const sn = (seasonRegex.exec(seasonObj.title || "") || [])[1];
      const seasonNumber = sn ? parseInt(sn, 10) : 1;
      for (const epObj of seasonObj.folder) {
        if (!epObj) continue;
        const en = (episodeRegex.exec(epObj.title || "") || [])[1];
        if (!en) continue;
        const epNumber = parseInt(en, 10);
        const streams = [];
        if (epObj.file?.startsWith("http")) streams.push({ url: epObj.file, quality: extractQuality(epObj.file) });
        if (Array.isArray(epObj.folder)) {
          for (const src of epObj.folder) {
            if (src?.file?.startsWith("http")) streams.push({ url: src.file, quality: extractQuality(src.file) });
          }
        }
        episodes.push({
          season: seasonNumber, episode: epNumber,
          title: `S${String(seasonNumber).padStart(2,"0")}E${String(epNumber).padStart(2,"0")}`,
          streams, subtitles: parseSubtitles(epObj.subtitle || ""),
        });
      }
    }
    return episodes;
  }

  async function fetchCinemeta(imdbId, type) {
    try {
      const data = await fetchJson(`${CINEMETA_URL}/${type}/${imdbId}.json`);
      return data?.meta || null;
    } catch (_) { return null; }
  }

  function extractImdbId(html) {
    return (html.match(/\b(tt\d{7,8})\b/) || [])[1] || null;
  }

  async function fetchTmdbId(imdbId, type) {
    try {
      const data = await fetchJson(
        `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
      );
      if (!data) return null;
      const r = type === "tv" ? data.tv_results?.[0] : data.movie_results?.[0];
      return r ? String(r.id) : null;
    } catch (_) { return null; }
  }

  async function fetchCast(tmdbId, tmdbType) {
    try {
      const data = await fetchJson(
        `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/credits?api_key=${TMDB_API_KEY}&language=en-US`
      );
      return (data?.cast || []).slice(0, 20).map(c => ({
        name: c.name || c.original_name || "",
        role: c.character || "",
        image: c.profile_path ? TMDB_IMAGE_BASE + c.profile_path : "",
      }));
    } catch (_) { return []; }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // getHome
  // ─────────────────────────────────────────────────────────────────────────────
  async function getHome(cb) {
    try {
      const homeData = {};
      for (const cat of HOME_CATEGORIES) {
        try {
          const { text } = await fetchPage(`${BASE_URL}/${cat.path}/`);
          homeData[cat.name] = parseListingHtml(text);
        } catch (_) { homeData[cat.name] = []; }
      }
      cb({ success: true, data: homeData });
    } catch (e) { cb({ success: false, error: e.message }); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // search
  // ─────────────────────────────────────────────────────────────────────────────
  async function search(query, cb) {
    try {
      const url = `${BASE_URL}/index.php?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(query)}`;
      const { text } = await fetchPage(url);
      cb({ success: true, data: parseListingHtml(text) });
    } catch (e) { cb({ success: false, error: e.message }); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // load
  // ─────────────────────────────────────────────────────────────────────────────
  async function load(url, cb) {
    try {
      const { text: html } = await fetchPage(url);

      const ogTitleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      const ogTitle = ogTitleMatch ? decodeEntities(ogTitleMatch[1]) : "";
      const title = ogTitle.replace(/\s*\(.*?\)\s*$/, "").trim() || "Unknown";

      const ogImgMatch =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      const poster = ogImgMatch ? ogImgMatch[1] : "";

      const bgMatch = html.match(/class="dar-full_bg[^"]*"[^>]*>\s*<a\s+href="([^"]+)"/i);
      const bgPoster = bgMatch ? bgMatch[1] : poster;

      const trailerMatch = html.match(/data-vbg=["']([^"']+)["']/i);
      const trailer = trailerMatch ? trailerMatch[1] : "";

      const descMatch = html.match(/<div[^>]*id=["']about["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      let description = descMatch ? decodeEntities(descMatch[1].replace(/<[^>]+>/g, "").trim()) : "";

      const yearMatch = ogTitle.match(/\((\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      const isSeries = url.includes("/tv-series/");
      const type = isSeries ? "series" : "movie";
      const tmdbType = isSeries ? "tv" : "movie";
      const cinemetaType = isSeries ? "series" : "movie";

      const audioMatch = html.match(/Audio language[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
      let audioLangs = audioMatch ? audioMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      if (audioLangs) description += ` - Audio: ${audioLangs}`;

      const ratingMatch = html.match(/<span[^>]*class="[^"]*rating-color[^"]*"[^>]*>([0-9.]+)<\/span>/i);
      const score = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

      const imdbId = extractImdbId(html);
      const logoUrl = imdbId ? `https://live.metahub.space/logo/medium/${imdbId}/img` : undefined;

      let meta = null, tmdbId = null, castList = [], genres = [], background = bgPoster;
      let finalDescription = description, epMetaMap = {};

      if (imdbId) {
        [meta, tmdbId] = await Promise.all([
          fetchCinemeta(imdbId, cinemetaType),
          fetchTmdbId(imdbId, tmdbType),
        ]);
      }

      if (meta) {
        if (meta.description) finalDescription = meta.description + (audioLangs ? ` - Audio: ${audioLangs}` : "");
        if (meta.background) background = meta.background;
        if (meta.genres) genres = meta.genres;
        if (meta.videos) {
          for (const v of meta.videos) {
            if (v.season != null && v.episode != null)
              epMetaMap[`${v.season}:${v.episode}`] = v;
          }
        }
      }

      if (tmdbId) castList = await fetchCast(tmdbId, tmdbType);

      const playerJson = extractPlayerData(html);

      if (isSeries) {
        const rawEps = parseSeriesEpisodes(playerJson);
        const episodes = rawEps.map(ep => {
          const epMeta = epMetaMap[`${ep.season}:${ep.episode}`];
          return new Episode({
            name: epMeta?.name || ep.title,
            url: JSON.stringify({ streams: ep.streams, subtitles: ep.subtitles }),
            season: ep.season, episode: ep.episode,
            airDate: epMeta?.released,
          });
        });
        cb({ success: true, data: new MultimediaItem({
          title: meta?.name || title, url, posterUrl: poster, bannerUrl: background,
          logoUrl, type: "series",
          year: year || (meta?.year ? parseInt(meta.year, 10) : undefined),
          score: meta?.imdbRating ? parseFloat(meta.imdbRating) : score,
          description: finalDescription,
          cast: castList.map(c => new Actor({ name: c.name, role: c.role, image: c.image })),
          trailers: trailer ? [new Trailer({ url: trailer })] : [],
          contentRating: meta?.appExtras?.certification,
          syncData: { imdb: imdbId, tmdb: tmdbId },
          episodes,
        })});
      } else {
        const parsed = playerJson ? parsePlayerStreams(playerJson) : { streams: [], subtitles: [] };
        cb({ success: true, data: new MultimediaItem({
          title: meta?.name || title, url, posterUrl: poster, bannerUrl: background,
          logoUrl, type: "movie",
          year: year || (meta?.year ? parseInt(meta.year, 10) : undefined),
          score: meta?.imdbRating ? parseFloat(meta.imdbRating) : score,
          description: finalDescription,
          cast: castList.map(c => new Actor({ name: c.name, role: c.role, image: c.image })),
          trailers: trailer ? [new Trailer({ url: trailer })] : [],
          contentRating: meta?.appExtras?.certification,
          syncData: { imdb: imdbId, tmdb: tmdbId },
          episodes: [new Episode({
            name: meta?.name || title,
            url: JSON.stringify({ streams: parsed.streams, subtitles: parsed.subtitles, sourceUrl: url }),
            season: 1, episode: 1,
          })],
        })});
      }
    } catch (e) { cb({ success: false, error: e.message }); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // loadStreams
  // ─────────────────────────────────────────────────────────────────────────────
  async function loadStreams(url, cb) {
    try {
      let data;
      try { data = JSON.parse(url); } catch (_) { data = { streams: [], subtitles: [], sourceUrl: url }; }

      let streams = data.streams || [];
      const subtitles = data.subtitles || [];
      const sourceUrl = data.sourceUrl;

      if (streams.length === 0 && sourceUrl) {
        try {
          const { text: html } = await fetchPage(sourceUrl);
          const playerJson = extractPlayerData(html);
          if (playerJson) {
            const parsed = parsePlayerStreams(playerJson);
            streams = parsed.streams;
            subtitles.push(...parsed.subtitles);
          }
        } catch (_) {}
      }

      if (streams.length === 0) { cb({ success: false, error: "No streams found." }); return; }

      cb({ success: true, data: streams.map(s => new StreamResult({
        url: s.url, quality: s.quality || "HD",
        headers: { Referer: BASE_URL + "/", "User-Agent": HEADERS["User-Agent"], Cookie: SITE_COOKIE },
        subtitles: subtitles.map(sub => ({ url: sub.subtitleUrl, label: sub.language, lang: sub.language })),
      }))});
    } catch (e) { cb({ success: false, error: e.message }); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Export to SkyStream runtime
  // ─────────────────────────────────────────────────────────────────────────────
  globalThis.getHome    = getHome;
  globalThis.search     = search;
  globalThis.load       = load;
  globalThis.loadStreams = loadStreams;
})();
