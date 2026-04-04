(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * EXACT port of Kotlin CloudStream provider logic
   * Supports: Movies, TV Series, Anime, Asian Dramas
   */

  // === CONFIGURATION ===
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const CINEMETA = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UTILS = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  const HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": `${manifest.baseUrl}/`
  };

  // === UTILITIES ===

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

  // EXACT Kotlin quality: regex (\d{3,4})[pP]
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
    if (s.includes("2k") || s.includes("1440")) return "1440p";
    if (s.includes("1080") || s.includes("full")) return "1080p";
    if (s.includes("720") || s.includes("hd")) return "720p";    if (s.includes("480") || s.includes("sd")) return "480p";
    if (s.includes("cam")) return "CAM";
    return "Auto";
  }

  function isSeries(u) { return /series|web-series|season/i.test(String(u)); }

  function dedupe(arr) {
    const s = new Set(), r = [];
    for (const i of arr) {
      if (i?.url && !s.has(i.url)) { s.add(i.url); r.push(i); }
    }
    return r;
  }

  function b64d(str) {
    if (!str) return "";
    try {
      let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) { return ""; }
  }

  function htmlDec(t) {
    return t ? String(t)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10))) : "";
  }

  function text(el) {
    return htmlDec((el?.textContent || "").replace(/\s+/g, " ").trim());
  }

  // === NETWORK ===

  async function req(u, h = {}) {
    return await http_get(u, { headers: { ...HEADERS, ...h } });
  }

  function isCF(r, url) {
    const b = String(r?.body || "").toLowerCase();
    const t = (b.match(/<title>([^<]*)</i)?.[1] || "").toLowerCase();
    return /cloudflare/.test(b) && /attention|verify|just a moment|cf-/i.test(b) || t.includes("just a moment");
  }

  async function doc(u, h = {}) {
    const r = await req(u, h);
    if (isCF(r, u)) throw new Error(`CLOUDFLARE: ${u}`);    return await parseHtml(r.body);
  }

  async function dynBase(src) {
    try {
      const r = await req(UTILS);
      const j = JSON.parse(r.body);
      return j?.[src]?.trim() || null;
    } catch (_) {
      return null;
    }
  }

  async function cinemeta(type, id) {
    try {
      const r = await req(`${CINEMETA}/${type}/${id}.json`, { "Accept": "application/json" });
      return JSON.parse(r.body);
    } catch (_) {
      return null;
    }
  }

  // === BYPASS - EXACT Kotlin regex ===

  async function bypass(id) {
    try {
      const r = await req(`https://web.sidexfee.com/?id=${id}`);
      const body = String(r.body || "");
      // EXACT Kotlin pattern: """link":"([^"]+)"""
      const match = body.match(/"link":"([^"]+)"/);
      if (match && match[1]) {
        // Kotlin: replace("\/", "/") before base64 decode
        return b64d(match[1].replace(/\\\//g, "/"));
      }
    } catch (_) {}
    return null;
  }

  async function resolveUrl(u, max = 7) {
    let cur = u;
    for (let i = 0; i < max; i++) {
      try {
        const r = await req(cur, {}, false);
        if (r.code === 200) break;
        if (r.code >= 300 && r.code < 400) {
          const loc = r.headers?.["location"] || r.headers?.["Location"];
          if (!loc) break;
          cur = loc;
        } else break;
      } catch (_) { break; }    }
    return cur;
  }

  // === EXTRACTORS - EXACT Kotlin logic ===

  async function extractGDFlix(url, callback) {
    try {
      // Dynamic base URL resolution
      let baseUrl = url.match(/^https?:\/\/[^/]+/)?.[0] || "";
      const latest = await dynBase("gdflix");
      if (latest && baseUrl !== latest) {
        url = url.replace(baseUrl, latest);
        baseUrl = latest;
      }

      const d = await doc(url);

      // EXACT Kotlin selectors
      const fileName = text(d.querySelector("ul > li.list-group-item:contains(Name)"))?.split("Name :")?.[1]?.trim() || "";
      const fileSize = text(d.querySelector("ul > li.list-group-item:contains(Size)"))?.split("Size :")?.[1]?.trim() || "";
      const quality = extractQuality(fileName);

      // EXACT Kotlin: div.text-center a
      const buttons = Array.from(d.querySelectorAll("div.text-center a"));

      for (const anchor of buttons) {
        const txt = text(anchor).toLowerCase();
        const href = anchor.getAttribute("href");
        if (!href) continue;

        let label = "";
        let finalUrl = href;

        // EXACT Kotlin when{} matching
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
        } else if (href.includes("pixeldra")) {          const base = href.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
          finalUrl = href.includes("download") ? href : `${base}/api/file/${href.split("/").pop()}?download`;
          label = "[Pixeldrain]";
        } else if (txt.includes("instant dl")) {
          try {
            const r = await req(href, {}, false);
            const loc = r.headers?.["location"] || "";
            const instant = loc.includes("url=") ? loc.split("url=")[1] : loc;
            if (instant) {
              finalUrl = instant;
              label = "[Instant Download]";
            } else continue;
          } catch (_) { continue; }
        } else if (txt.includes("gofile")) {
          const results = await loadGenericExtractor(href);
          for (const res of results) callback(res);
          continue;
        } else {
          continue;
        }

        if (finalUrl && finalUrl.startsWith("http")) {
          callback(new StreamResult({
            source: `GDFlix${label}`,
            name: `GDFlix${label} ${fileName ? `[${fileName}]` : ""} ${fileSize ? `[${fileSize}]` : ""}`.trim(),
            url: finalUrl,
            quality: quality,
            headers: { "Referer": url, "User-Agent": UA }
          }));
        }
      }

      // Kotlin CF backup: newUrl.replace("file", "wfile")
      try {
        const cfUrl = url.replace("/file/", "/wfile/");
        if (cfUrl !== url) {
          const cfDoc = await doc(cfUrl);
          const cfBtns = cfDoc.querySelectorAll("a.btn-success");
          for (const btn of cfBtns) {
            const cfHref = btn.getAttribute("href");
            if (cfHref) {
              const resolved = await resolveUrl(cfHref);
              if (resolved) {
                callback(new StreamResult({
                  source: "GDFlix[CF]",
                  name: `GDFlix[CF] ${fileName ? `[${fileName}]` : ""}`,
                  url: resolved,
                  quality: quality,
                  headers: { "Referer": url, "User-Agent": UA }
                }));              }
            }
          }
        }
      } catch (_) {}

    } catch (_) {}
  }

  async function extractFastDL(url, callback) {
    try {
      const r = await req(url, {}, false);
      const loc = r.headers?.["location"] || r.headers?.["Location"];
      if (loc) {
        const results = await loadGenericExtractor(loc);
        for (const res of results) callback(res);
      }
    } catch (_) {}
  }

  async function loadGenericExtractor(url) {
    const results = [];
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes("pixeldrain")) {
      const base = url.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
      const final = url.includes("download") ? url : `${base}/api/file/${url.split("/").pop()}?download`;
      results.push(new StreamResult({ source: "Pixeldrain", url: final, headers: { "Referer": url, "User-Agent": UA } }));
    } else if (hostname.includes("gofile")) {
      results.push(new StreamResult({ source: "Gofile", url: url, headers: { "Referer": url, "User-Agent": UA } }));
    } else {
      results.push(new StreamResult({ source: "Generic", url: url, headers: { "Referer": url, "User-Agent": UA } }));
    }
    return results;
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
        try {          const url = sec.path ? `${manifest.baseUrl}${sec.path}` : manifest.baseUrl;
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
      cb({ success: true, data: data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e) });
    }
  }

  async function search(query, cb) {
    try {
      const q = encodeURIComponent(String(query || "").trim());
      const url = `${manifest.baseUrl}/search/${q}/page/1/`;
      const d = await doc(url);
      const results = Array.from(d.querySelectorAll("div.post-cards > article"))
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
      cb({ success: true, data: dedupe(results).slice(0, 40) });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
    }
  }

  async function load(url, cb) {
    try {
      const d = await doc(url);
      let title = clean(d.querySelector("title")?.textContent);
      let poster = normUrl(d.querySelector("meta[property='og:image']")?.getAttribute("content"), manifest.baseUrl);
      let desc = d.querySelector("span#summary")?.textContent?.trim() || "";      const isSer = isSeries(url) || /series|web-series/i.test(title);

      // IMDb + Cinemeta enrichment
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
          // === SERIES - EXACT Kotlin episode parsing ===
          const epMap = new Map();
          const buttons = Array.from(d.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn"));

          for (const btn of buttons) {
            let link = btn.getAttribute("href");
            if (!link) continue;
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
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
              for (const epA of epLinks) {                const epUrl = epA.getAttribute("href");
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
              episodes.push(new Episode({
                name: ep.name,
                url: JSON.stringify([{ url: ep.url, source: "primary" }]),
                season: season,
                episode: epNum,
                posterUrl: ep.poster,
                description: ep.desc
              }));
            }
          }
          episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

          const item = new MultimediaItem({
            title, url, posterUrl: poster, bannerUrl: bg, description: desc,
            year, score: rating ? parseFloat(rating) * 10 : null, tags: genres, cast: actors,
            type: "series", contentType: "series",
            episodes: episodes.length > 0 ? episodes : [new Episode({
              name: title,
              url: JSON.stringify([{ url, source: "primary" }]),
              season: 1, episode: 1, posterUrl: poster
            })]
          });
          cb({ success: true, data: item });
          return;
        } else {
          // === MOVIE - EXACT Kotlin: select a.dl ===
          const sources = [];
          const buttons = Array.from(d.querySelectorAll("a.dl"));
          for (const btn of buttons) {            let link = btn.getAttribute("href");
            if (!link) continue;
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              link = await bypass(id) || link;
            }
            sources.push({ url: link, source: "primary" });
          }
          const item = new MultimediaItem({
            title, url, posterUrl: poster, bannerUrl: bg, description: desc,
            year, score: rating ? parseFloat(rating) * 10 : null, tags: genres, cast: actors,
            type: "movie", contentType: "movie",
            episodes: [new Episode({
              name: title,
              url: JSON.stringify(sources),
              season: 1, episode: 1, posterUrl: poster
            })]
          });
          cb({ success: true, data: item });
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
          }
          const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
          const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
          const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          episodes.push(new Episode({
            name: `Episode ${epNum}`,
            url: JSON.stringify([{ url: link, source: "primary" }]),
            season: seasonNum,
            episode: epNum,
            posterUrl: poster
          }));
          epNum++;
        }
        const item = new MultimediaItem({
          title, url, posterUrl: poster, description: desc,
          type: "series", contentType: "series",          episodes: episodes.length > 0 ? episodes : [new Episode({
            name: title,
            url: JSON.stringify([{ url, source: "primary" }]),
            season: 1, episode: 1, posterUrl: poster
          })]
        });
        cb({ success: true, data: item });
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
          sources.push({ url: link, source: "primary" });
        }
        const item = new MultimediaItem({
          title, url, posterUrl: poster, description: desc,
          type: "movie", contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: JSON.stringify(sources),
            season: 1, episode: 1, posterUrl: poster
          })]
        });
        cb({ success: true, data: item });
      }
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
    }
  }

  // === loadStreams - EXACT Kotlin loadLinks routing ===
  async function loadStreams(data, cb) {
    try {
      let sources = [];
      if (typeof data === "string") {
        try { sources = JSON.parse(data); } catch (_) { sources = [{ url: data, source: "primary" }]; }
      } else if (Array.isArray(data)) {
        sources = data;
      } else if (data?.url) {
        sources = (typeof data.url === "string" && data.url.startsWith("["))
          ? JSON.parse(data.url)
          : [{ url: data.url, source: "primary" }];
      }

      if (!sources?.length) return cb({ success: true, data: [] });
      const results = [];
      const seen = new Set();

      for (const src of sources) {
        const url = src.url || src;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        // EXACT Kotlin routing: source.contains("gdflix") || source.contains("gdlink")
        const srcStr = String(url).toLowerCase();

        if (srcStr.includes("gdflix") || srcStr.includes("gdlink")) {
          await extractGDFlix(url, (stream) => {
            if (!seen.has(stream.url)) { seen.add(stream.url); results.push(stream); }
          });
        } else if (srcStr.includes("fastdlserver")) {
          await extractFastDL(url, (stream) => {
            if (!seen.has(stream.url)) { seen.add(stream.url); results.push(stream); }
          });
        } else {
          const generic = await loadGenericExtractor(url);
          for (const s of generic) {
            if (!seen.has(s.url)) { seen.add(s.url); results.push(s); }
          }
        }
      }

      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
    }
  }

  // === EXPORTS - ALL FOUR REQUIRED ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
