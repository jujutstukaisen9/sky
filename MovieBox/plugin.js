(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * Fixed link extraction following working plugin patterns
   */

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const CINEMETA = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UTILS = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  // === CRITICAL FIX: http_get takes headers directly, not { headers: {} } ===
  const HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": `${manifest.baseUrl}/`
  };

  // === UTILS ===
  function normUrl(u, base) {
    if (!u) return "";
    u = String(u).trim();
    if (!u) return "";
    if (u.startsWith("//")) return `https:${u}`;
    if (/^https?:\/\//i.test(u)) return u;
    return u.startsWith("/") ? `${base}${u}` : `${base}/${u}`;
  }

  function clean(t) {
    return t ? String(t).replace(/Download\s+/gi, "").replace(/\s+/g, " ").trim() : "Unknown";
  }

  function extractQuality(text) {
    if (!text) return "Auto";
    const match = String(text).match(/(\d{3,4})[pP]/);
    if (match && match[1]) {
      const q = parseInt(match[1], 10);
      if (q >= 2160) return "4K";
      if (q >= 1440) return "1440p";
      if (q >= 1080) return "1080p";
      if (q >= 720) return "720p";
      if (q >= 480) return "480p";
    }
    const s = String(text).toLowerCase();
    if (s.includes("4k") || s.includes("2160")) return "4K";
    if (s.includes("1080") || s.includes("full")) return "1080p";
    if (s.includes("720") || s.includes("hd")) return "720p";
    if (s.includes("480") || s.includes("sd")) return "480p";
    if (s.includes("cam")) return "CAM";
    return "Auto";
  }
  function isSeries(u) { return /series|web-series|season/i.test(String(u)); }
  function dedupe(arr) { const s = new Set(), r = []; for (const i of arr) { if (i?.url && !s.has(i.url)) { s.add(i.url); r.push(i); } } return r; }
  
  function b64d(str) {
    if (!str) return "";
    try {
      let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) { return ""; }
  }

  function htmlDec(t) {
    return t ? String(t).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(parseInt(c,10))) : "";
  }
  function text(el) { return htmlDec((el?.textContent||"").replace(/\s+/g," ").trim()); }

  // === NETWORK - CRITICAL FIX: headers passed directly to http_get ===
  async function req(u, h = {}) {
    return await http_get(u, { ...HEADERS, ...h });  // ← NOT { headers: {...} }
  }

  function isCF(r, url) {
    const b = String(r?.body||"").toLowerCase();
    const t = (b.match(/<title>([^<]*)</i)?.[1]||"").toLowerCase();
    return /cloudflare/.test(b) && /attention|verify|just a moment|cf-/i.test(b) || t.includes("just a moment");
  }

  async function doc(u, h = {}) {
    const r = await req(u, h);
    if (isCF(r, u)) throw new Error(`CLOUDFLARE: ${u}`);
    return await parseHtml(r.body);  // ← Direct parseHtml, no wrapper
  }

  async function dynBase(src) {
    try { const r = await req(UTILS); const j = JSON.parse(r.body); return j?.[src]?.trim() || null; } catch(_) { return null; }
  }
  
  async function cinemeta(type, id) {
    try { const r = await req(`${CINEMETA}/${type}/${id}.json`, {"Accept":"application/json"}); return JSON.parse(r.body); } catch(_) { return null; }
  }

  // === BYPASS - EXACT pattern matching ===
  async function bypass(id) {
    try {
      const r = await req(`https://web.sidexfee.com/?id=${id}`);
      const body = String(r.body || "");
      // Try multiple patterns for protected link extraction
      const patterns = [        /"link":"([^"]+)"/,
        /"url":"([^"]+)"/,
        /data-link="([^"]+)"/,
        /href="([^"]+)"[^>]*class="[^"]*download/
      ];
      for (const pat of patterns) {
        const match = body.match(pat);
        if (match && match[1]) {
          let decoded = match[1].replace(/\\\//g, "/");
          // Try base64 decode, fallback to raw URL
          try { return b64d(decoded); } catch(_) { return decoded; }
        }
      }
    } catch (_) {}
    return null;
  }

  async function resolveUrl(u, max = 7) {
    let cur = u;
    for (let i = 0; i < max; i++) {
      try {
        // CRITICAL: http_get with allowRedirects in options object
        const r = await http_get(cur, { ...HEADERS, allowRedirects: false });
        if (r.code === 200) break;
        if (r.code >= 300 && r.code < 400) {
          const loc = r.headers?.["location"] || r.headers?.["Location"];
          if (!loc) break;
          cur = loc;
        } else break;
      } catch (_) { break; }
    }
    return cur;
  }

  // === EXTRACTORS - CRITICAL: Push to array, don't return ===
  
  async function extractGDFlix(url, streams) {
    try {
      let baseUrl = url.match(/^https?:\/\/[^/]+/)?.[0] || "";
      const latest = await dynBase("gdflix");
      if (latest && baseUrl !== latest) {
        url = url.replace(baseUrl, latest);
        baseUrl = latest;
      }

      const d = await doc(url);
      const fileName = text(d.querySelector("ul > li:contains(Name)"))?.split("Name :")?.[1]?.trim() || "";
      const fileSize = text(d.querySelector("ul > li:contains(Size)"))?.split("Size :")?.[1]?.trim() || "";
      const quality = extractQuality(fileName);
      const buttons = Array.from(d.querySelectorAll("div.text-center a, a.btn-success"));
      
      for (const anchor of buttons) {
        const txt = text(anchor).toLowerCase();
        const href = anchor.getAttribute("href");
        if (!href) continue;

        let label = "";
        let finalUrl = href;

        if (txt.includes("fsl v2")) {
          label = "[FSL V2]";
        } else if (txt.includes("direct dl") || txt.includes("direct server")) {
          label = "[Direct]";
        } else if (txt.includes("cloud download") && txt.includes("r2")) {
          label = "[Cloud]";
        } else if (txt.includes("fast cloud")) {
          try {
            const nested = await doc(`${baseUrl}${href}`);
            const dlink = nested.querySelector("div.card-body a")?.getAttribute("href");
            if (!dlink) continue;
            finalUrl = dlink;
            label = "[FAST CLOUD]";
          } catch (_) { continue; }
        } else if (href.includes("pixeldra")) {
          const base = href.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
          finalUrl = href.includes("download") ? href : `${base}/api/file/${href.split("/").pop()}?download`;
          label = "[Pixeldrain]";
        } else if (txt.includes("instant dl")) {
          try {
            const r = await http_get(href, { ...HEADERS, allowRedirects: false });
            const loc = r.headers?.["location"] || "";
            const instant = loc.includes("url=") ? loc.split("url=")[1] : loc;
            if (instant) { finalUrl = instant; label = "[Instant]"; }
            else continue;
          } catch (_) { continue; }
        } else if (txt.includes("gofile")) {
          // Fallback: push as-is for SkyStream built-in GoFile support
          streams.push(new StreamResult({ url: href, source: "Gofile", quality: quality, headers: { "Referer": url, "User-Agent": UA } }));
          continue;
        } else {
          continue;
        }

        if (finalUrl && finalUrl.startsWith("http")) {
          // CRITICAL: Minimal StreamResult - only required fields
          streams.push(new StreamResult({
            url: finalUrl,
            source: `GDFlix${label}`,
            quality: quality,            headers: { "Referer": url, "User-Agent": UA }
          }));
        }
      }

      // CF backup
      try {
        const cfUrl = url.replace("/file/", "/wfile/");
        if (cfUrl !== url) {
          const cfDoc = await doc(cfUrl);
          for (const btn of cfDoc.querySelectorAll("a.btn-success")) {
            const cfHref = btn.getAttribute("href");
            if (cfHref) {
              const resolved = await resolveUrl(cfHref);
              if (resolved) {
                streams.push(new StreamResult({
                  url: resolved,
                  source: "GDFlix[CF]",
                  quality: quality,
                  headers: { "Referer": url, "User-Agent": UA }
                }));
              }
            }
          }
        }
      } catch (_) {}
    } catch (_) {}
  }

  async function extractFastDL(url, streams) {
    try {
      const r = await http_get(url, { ...HEADERS, allowRedirects: false });
      const loc = r.headers?.["location"] || r.headers?.["Location"];
      if (loc) {
        // Push resolved URL directly
        streams.push(new StreamResult({ url: loc, source: "FastDL", headers: { "Referer": url, "User-Agent": UA } }));
      }
    } catch (_) {}
  }

  // Generic extractor - CRITICAL: Push minimal StreamResult
  async function loadGenericExtractor(url, streams) {
    const hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.includes("pixeldrain")) {
      const base = url.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
      const final = url.includes("download") ? url : `${base}/api/file/${url.split("/").pop()}?download`;
      streams.push(new StreamResult({ url: final, source: "Pixeldrain", headers: { "Referer": url, "User-Agent": UA } }));
    } else if (hostname.includes("gofile")) {
      streams.push(new StreamResult({ url: url, source: "Gofile", headers: { "Referer": url, "User-Agent": UA } }));    } else {
      // CRITICAL: Always push something - SkyStream needs at least url+source
      streams.push(new StreamResult({ url: url, source: "Generic", headers: { "Referer": url, "User-Agent": UA } }));
    }
  }

  // === CORE FUNCTIONS ===

  async function getHome(cb) {
    try {
      const sections = [
        { name: "Trending", path: "" },
        { name: "Bollywood Movies", path: "/movies/bollywood/" },
        { name: "Hollywood Movies", path: "/movies/hollywood/" },
        { name: "Anime", path: "/anime/" }
      ];
      const data = {};

      for (const sec of sections) {
        try {
          const url = sec.path ? `${manifest.baseUrl}${sec.path}` : manifest.baseUrl;
          const d = await doc(url);
          const items = Array.from(d.querySelectorAll("div.post-cards > article"))
            .map(el => {
              const a = el.querySelector("a");
              if (!a) return null;
              const title = clean(a.getAttribute("title"));
              const href = normUrl(a.getAttribute("href"), manifest.baseUrl);
              const poster = normUrl(el.querySelector("img")?.getAttribute("src"), manifest.baseUrl);
              if (!title || !href) return null;
              return new MultimediaItem({ title, url: href, posterUrl: poster, type: "movie", contentType: "movie" });
            })
            .filter(Boolean);
          if (items.length > 0) data[sec.name] = dedupe(items).slice(0, 30);
        } catch (e) { data[sec.name] = []; }
      }
      cb({ success: true,  data });
    } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: String(e) }); }
  }

  async function search(query, cb) {
    try {
      const q = encodeURIComponent(String(query||"").trim());
      const url = `${manifest.baseUrl}/search/${q}/page/1/`;
      const d = await doc(url);
      const results = Array.from(d.querySelectorAll("div.post-cards > article"))
        .map(el => {
          const a = el.querySelector("a");
          if (!a) return null;
          const title = clean(a.getAttribute("title"));          const href = normUrl(a.getAttribute("href"), manifest.baseUrl);
          const poster = normUrl(el.querySelector("img")?.getAttribute("src"), manifest.baseUrl);
          if (!title || !href) return null;
          return new MultimediaItem({ title, url: href, posterUrl: poster, type: "movie", contentType: "movie" });
        })
        .filter(Boolean);
      cb({ success: true,  dedupe(results).slice(0, 40) });
    } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) }); }
  }

  async function load(url, cb) {
    try {
      const d = await doc(url);
      let title = clean(d.querySelector("title")?.textContent);
      let poster = normUrl(d.querySelector("meta[property='og:image']")?.getAttribute("content"), manifest.baseUrl);
      let desc = d.querySelector("span#summary")?.textContent?.trim() || "";
      const isSer = isSeries(url) || /series|web-series/i.test(title);

      const imdbA = d.querySelector("div.imdb_left > a");
      const imdbUrl = imdbA?.getAttribute("href");
      let cm = null;
      if (imdbUrl) {
        const id = imdbUrl.split("title/")?.[1]?.split("/")?.[0];
        if (id) cm = await cinemeta(isSer ? "tv" : "movie", id);
      }

      if (cm?.meta) {
        const m = cm.meta;
        title = m.name || title;
        desc = m.description || desc;
        poster = m.poster || poster;
        const bg = m.background || poster;
        const genres = m.genre || [];
        const cast = m.cast || [];
        const rating = m.imdbRating || "";
        const year = m.year ? parseInt(m.year) : null;
        const actors = cast.map(c => new Actor({
          name: c.name || c,
          role: c.role || c.character || "",
          image: c.image || c.profile_path ? `https://image.tmdb.org/t/p/w500${c.profile_path}` : null
        }));

        if (isSer) {
          const epMap = new Map();
          const buttons = Array.from(d.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn"));
          
          for (const btn of buttons) {
            let link = btn.getAttribute("href");
            if (!link) continue;
            if (link.includes("id=")) {              const id = link.split("id=").pop();
              link = await bypass(id) || link;
            }
            const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
            const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
            const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
            
            try {
              const seasonDoc = await doc(link);
              const epLinks = Array.from(seasonDoc.querySelectorAll("h3 > a"))
                .filter(a => !text(a).toLowerCase().includes("zip"));
              
              let epNum = 1;
              for (const epA of epLinks) {
                const epUrl = epA.getAttribute("href");
                if (!epUrl) continue;
                const epInfo = cm.meta?.videos?.find(v => v.season === seasonNum && v.episode === epNum);
                const epData = {
                  url: epUrl,
                  name: epInfo?.name || epInfo?.title || `Episode ${epNum}`,
                  season: seasonNum,
                  episode: epNum,
                  poster: epInfo?.thumbnail || poster,
                  desc: epInfo?.overview || ""
                };
                if (!epMap.has(seasonNum)) epMap.set(seasonNum, new Map());
                epMap.get(seasonNum).set(epNum, epData);
                epNum++;
              }
            } catch (_) {}
          }
          
          const episodes = [];
          for (const [season, eps] of epMap) {
            for (const [epNum, ep] of eps) {
              // CRITICAL FIX: Episode URL format - simple object, NOT array with source
              episodes.push(new Episode({
                name: ep.name,
                url: JSON.stringify({ url: ep.url }),  // ← NOT [{url, source}]
                season: season,
                episode: epNum,
                posterUrl: ep.poster,
                description: ep.desc
              }));
            }
          }
          episodes.sort((a,b) => (a.season-b.season)||(a.episode-b.episode));
          
          const item = new MultimediaItem({
            title, url, posterUrl: poster, bannerUrl: bg, description: desc,            year, score: rating?parseFloat(rating)*10:null, tags: genres, cast: actors,
            type: "series", contentType: "series",
            episodes: episodes.length>0 ? episodes : [new Episode({
              name: title,
              url: JSON.stringify({ url }),  // ← Simple object
              season: 1, episode: 1, posterUrl: poster
            })]
          });
          cb({ success: true,  item });
          return;
        } else {
          const sources = [];
          const buttons = Array.from(d.querySelectorAll("a.dl"));
          for (const btn of buttons) {
            let link = btn.getAttribute("href");
            if (!link) continue;
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              link = await bypass(id) || link;
            }
            // CRITICAL: Store simple object, not array with source field
            sources.push({ url: link });
          }
          const item = new MultimediaItem({
            title, url, posterUrl: poster, bannerUrl: bg, description: desc,
            year, score: rating?parseFloat(rating)*10:null, tags: genres, cast: actors,
            type: "movie", contentType: "movie",
            episodes: [new Episode({
              name: title,
              url: JSON.stringify({ url: sources[0]?.url || url }),  // ← Simple object
              season: 1, episode: 1, posterUrl: poster
            })]
          });
          cb({ success: true,  item });
          return;
        }
      }
      
      // Fallback without Cinemeta
      if (isSer) {
        const episodes = [];
        const buttons = Array.from(d.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn"));
        let epNum = 1;
        for (const btn of buttons) {
          let link = btn.getAttribute("href");
          if (!link) continue;
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            link = await bypass(id) || link;
          }          const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
          const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
          const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          episodes.push(new Episode({
            name: `Episode ${epNum}`,
            url: JSON.stringify({ url: link }),  // ← Simple object
            season: seasonNum,
            episode: epNum,
            posterUrl: poster
          }));
          epNum++;
        }
        const item = new MultimediaItem({
          title, url, posterUrl: poster, description: desc,
          type: "series", contentType: "series",
          episodes: episodes.length>0 ? episodes : [new Episode({
            name: title,
            url: JSON.stringify({ url }),
            season: 1, episode: 1, posterUrl: poster
          })]
        });
        cb({ success: true,  item });
      } else {
        const sources = [];
        const buttons = Array.from(d.querySelectorAll("a.dl"));
        for (const btn of buttons) {
          let link = btn.getAttribute("href");
          if (!link) continue;
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            link = await bypass(id) || link;
          }
          sources.push({ url: link });
        }
        const item = new MultimediaItem({
          title, url, posterUrl: poster, description: desc,
          type: "movie", contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: JSON.stringify({ url: sources[0]?.url || url }),
            season: 1, episode: 1, posterUrl: poster
          })]
        });
        cb({ success: true,  item });
      }
    } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) }); }
  }

  // === loadStreams - CRITICAL: Extractors push to array, don't return ===
  async function loadStreams(data, cb) {    try {
      // Parse episode data - CRITICAL: Handle simple {url} object format
      let url = null;
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data);
          // Handle both {url} and [{url}] formats
          if (Array.isArray(parsed)) url = parsed[0]?.url || parsed[0];
          else if (parsed?.url) url = parsed.url;
          else url = parsed;
        } catch(_) { url = data; }
      } else if (Array.isArray(data)) {
        url = data[0]?.url || data[0];
      } else if (data?.url) {
        url = data.url;
      }
      
      if (!url) return cb({ success: true,  [] });
      
      const streams = [];
      const srcStr = String(url).toLowerCase();
      
      // CRITICAL: Extractors take (url, streams) and PUSH to array
      if (srcStr.includes("gdflix") || srcStr.includes("gdlink")) {
        await extractGDFlix(url, streams);
      } else if (srcStr.includes("fastdlserver")) {
        await extractFastDL(url, streams);
      } else {
        await loadGenericExtractor(url, streams);
      }
      
      // Deduplicate
      const seen = new Set();
      const results = streams.filter(s => {
        if (!s?.url || seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });
      
      cb({ success: true,  results });
    } catch (e) { cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) }); }
  }

  // === EXPORTS ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
