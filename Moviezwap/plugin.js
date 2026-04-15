// SkyStream Plugin: Moviezwap
// Exports must be CommonJS compatible for CLI sandbox
const http = typeof http_get !== 'undefined' ? http_get : fetch;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive"
};

// Safe HTML extractor (no DOMParser dependency)
function extract(html, pattern, group = 1) {
  const match = html.match(pattern);
  return match ? match[group].trim() : '';
}

function fixUrl(url, base) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return base.replace(/\/$/, '') + url;
  return url;
}

function getQuality(text) {
  const t = (text || '').toLowerCase();
  if (/2160p|4k/.test(t)) return '2160p';
  if (/1080p/.test(t)) return '1080p';
  if (/720p/.test(t)) return '720p';
  if (/480p/.test(t)) return '480p';
  if (/320p|360p/.test(t)) return '320p';
  return 'Auto';
}

function isSeries(text) {
  return /season|episode|eps|web series/i.test(text || '');
}

async function getBody(url) {
  const res = await http(url, { headers: HEADERS });
  // Handle both fetch and custom http_get responses
  return res.text ? await res.text() : res.body;
}

// ==================== CORE METHODS ====================

async function getHome() {
  const categories = [
    { name: "Trending", path: "/category/Telugu-(2025)-Movies.html" },    { name: "Telugu 2026", path: "/category/Telugu-(2026)-Movies.html" },
    { name: "Tamil 2026", path: "/category/Tamil-(2026)-Movies.html" },
    { name: "Hollywood Dubbed", path: "/category/Telugu-Dubbed-Movies-[Hollywood].html" }
  ];

  const results = {};
  const base = globalThis.manifest?.baseUrl || "https://www.moviezwap.surf";

  for (const cat of categories) {
    try {
      const html = await getBody(`${base}${cat.path}`);
      const links = [...html.matchAll(/<a[^>]*href="([^"]*\/movie\/[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
      
      results[cat.name] = links.map(m => ({
        name: m[2].replace(/<[^>]+>/g, '').trim() || 'Unknown',
        url: fixUrl(m[1], base),
        type: isSeries(m[2]) ? 'tvseries' : 'movie',
        posterUrl: ''
      }));
    } catch {
      results[cat.name] = [];
    }
  }
  return results;
}

async function search(query) {
  const base = globalThis.manifest?.baseUrl || "https://www.moviezwap.surf";
  try {
    const html = await getBody(`${base}/search.php?q=${encodeURIComponent(query)}`);
    const links = [...html.matchAll(/<a[^>]*href="([^"]*\/movie\/[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    
    return links.map(m => ({
      name: m[2].replace(/<[^>]+>/g, '').trim() || 'Unknown',
      url: fixUrl(m[1], base),
      type: isSeries(m[2]) ? 'tvseries' : 'movie',
      posterUrl: ''
    }));
  } catch {
    return [];
  }
}

async function load(url) {
  const base = globalThis.manifest?.baseUrl || "https://www.moviezwap.surf";
  try {
    const html = await getBody(url);
    
    const title = extract(html, /<title>([^<]+)<\/title>/i).split(/\s*-\s*/)[0] || 'Unknown';
    const poster = extract(html, /<img[^>]*src="([^"]*poster[^"]*)"[^>]*>/i);    const descMatch = /<td[^>]*>[^<]*Desc[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const yearMatch = /\b(19|20)\d{2}\b/.exec(title);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    const links = [...html.matchAll(/<a[^>]*href="([^"]*\/movie\/[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const episodes = links.length > 0 && isSeries(title)
      ? links.map((l, i) => ({ name: l[2].replace(/<[^>]+>/g, '').trim(), url: fixUrl(l[1], base), season: 1, episode: i + 1 }))
      : [{ name: 'Movie', url, season: 1, episode: 1 }];

    return {
      name: title.replace(/Moviezwap/gi, '').trim(),
      url,
      type: isSeries(title) ? 'tvseries' : 'movie',
      posterUrl: fixUrl(poster, base),
      year,
      description,
      episodes
    };
  } catch (e) {
    throw new Error(`load failed: ${e.message}`);
  }
}

async function loadStreams(url) {
  const base = globalThis.manifest?.baseUrl || "https://www.moviezwap.surf";
  try {
    const html = await getBody(url);
    const streams = [];

    // Find dwload/download links
    const matches = [...html.matchAll(/<a[^>]*href="([^"]*(?:dwload|download)\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    
    for (const m of matches) {
      streams.push({
        url: fixUrl(m[1].replace('dwload.php', 'download.php'), base),
        title: `Moviezwap - ${m[2].replace(/<[^>]+>/g, '').trim()}`,
        quality: getQuality(m[2]),
        headers: HEADERS,
        type: 'direct'
      });
    }

    return streams;
  } catch (e) {
    throw new Error(`loadStreams failed: ${e.message}`);
  }
}

// SkyStream CLI requires module.exports or globalThis attachmentmodule.exports = { getHome, search, load, loadStreams };
globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
globalThis.loadStreams = loadStreams;
