(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * Library code preserved. Streaming/downloading fixed to match Kotlin logic.
   * CRITICAL: Episode.url = raw URL string. loadStreams receives raw URL.
   */

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const CINEMETA_URL = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UTILS_URL = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": manifest.baseUrl + "/"
  };

  // === HELPER FUNCTIONS (Your working code - PRESERVED) ===
  function normalizeUrl(url, base) {
    if (!url) return "";
    const raw = String(url).trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return "https:" + raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return base + raw;
    return base + "/" + raw;
  }

  function cleanTitle(raw) {
    if (!raw) return "Unknown";
    return String(raw).replace(/Download\s+/gi, "").replace(/\s+/g, " ").trim();
  }

  function extractQuality(text) {
    if (!text) return "Auto";
    const t = String(text).toLowerCase();
    if (t.includes("2160") || t.includes("4k") || t.includes("ultra")) return "4K";
    if (t.includes("1080") || t.includes("full")) return "1080p";
    if (t.includes("1440") || t.includes("quad")) return "1440p";
    if (t.includes("720") || t.includes("hd")) return "720p";
    if (t.includes("480") || t.includes("sd")) return "480p";
    if (t.includes("360")) return "360p";
    if (t.includes("cam")) return "CAM";
    return "Auto";
  }

  function isSeriesUrl(url) {
    return /series|web-series|season/i.test(String(url));
  }
  function uniqueByUrl(items) {
    const out = [];
    const seen = new Set();
    for (const it of items) {
      if (!it || !it.url || seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
    }
    return out;
  }

  function safeBase64Decode(str) {
    if (!str) return "";
    try {
      let s = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) {
      try { return atob(str); } catch (__) { return ""; }
    }
  }

  function htmlDecode(text) {
    if (!text) return "";
    return String(text)
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  }

  function textOf(el) {
    return htmlDecode((el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim());
  }

  // === NETWORK (Your working code - PRESERVED, minor syntax fix) ===
  async function request(url, headers) {
    headers = headers || {};
    var opts = {};
    for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
    for (var k in headers) opts[k] = headers[k];
    return await http_get(url, opts);
  }

  function isCloudflareBlocked(response, targetUrl) {
    const body = String(response && response.body ? response.body : "");
    const headerServer = (response && response.headers && (response.headers["server"] || response.headers["Server"]) || "").toLowerCase();
    const titleMatch = body.match(/<title>([^<]*)</i);
    const title = (titleMatch && titleMatch[1] ? titleMatch[1] : "").toLowerCase();
    
    if (/cloudflare/i.test(body) && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
    if (title.includes("just a moment") || title.includes("attention required")) return true;
    if (headerServer.includes("cloudflare") && /checking your browser|verify you are human/i.test(body)) return true;    if (String(targetUrl || "").includes("/cdn-cgi/challenge-platform/")) return true;
    return false;
  }

  async function loadDoc(url, headers) {
    headers = headers || {};
    const res = await request(url, headers);
    const finalUrl = String(res && (res.finalUrl || res.url) ? (res.finalUrl || res.url) : url || "");
    
    if (isCloudflareBlocked(res, finalUrl)) {
      throw new Error("CLOUDFLARE_BLOCKED: " + finalUrl);
    }
    return await parseHtml(res.body);
  }

  async function fetchDynamicBaseUrl(source) {
    try {
      const res = await request(UTILS_URL);
      const urls = JSON.parse(res.body);
      return (urls && urls[source] && urls[source].trim) ? urls[source].trim() : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchCinemetaData(type, imdbId) {
    try {
      const url = CINEMETA_URL + "/" + type + "/" + imdbId + ".json";
      const res = await request(url, { "Accept": "application/json" });
      return JSON.parse(res.body);
    } catch (_) {
      return null;
    }
  }

  // === BYPASS (Exact Kotlin logic) ===
  async function bypassProtectedLink(id) {
    try {
      const url = "https://web.sidexfee.com/?id=" + id;
      const res = await request(url);
      const body = String(res.body || "");
      // Kotlin: """link":"([^"]+)""" + replace("\/", "/") + base64 decode
      const match = body.match(/"link":"([^"]+)"/);
      if (match && match[1]) {
        const decoded = match[1].replace(/\\\//g, "/");
        try { return safeBase64Decode(decoded); } catch(_) { return decoded; }
      }
    } catch (_) {}
    return null;
  }
  async function resolveFinalUrl(startUrl, maxRedirects) {
    maxRedirects = maxRedirects || 7;
    let currentUrl = startUrl;
    for (let i = 0; i < maxRedirects; i++) {
      try {
        var opts = {};
        for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
        opts.allowRedirects = false;
        const res = await http_get(currentUrl, opts);
        if (res.code === 200) break;
        if (res.code >= 300 && res.code < 400) {
          const location = res.headers && (res.headers["location"] || res.headers["Location"]);
          if (!location) break;
          currentUrl = location;
        } else {
          break;
        }
      } catch (_) {
        break;
      }
    }
    return currentUrl;
  }

  // === EXTRACTORS (Exact Kotlin GDFlix/FastDL logic) ===

  async function extractGDFlix(url, streams) {
    try {
      // Dynamic base URL (Kotlin: getLatestBaseUrl)
      let baseUrl = (url.match(/^https?:\/\/[^/]+/) || [""])[0];
      const latest = await fetchDynamicBaseUrl("gdflix");
      if (latest && baseUrl !== latest) {
        url = url.replace(baseUrl, latest);
        baseUrl = latest;
      }

      const doc = await loadDoc(url);
      
      // Kotlin: ul > li.list-group-item:contains(Name/Size)
      const nameLi = doc.querySelector("ul > li.list-group-item:contains(Name)");
      const sizeLi = doc.querySelector("ul > li.list-group-item:contains(Size)");
      const fileName = nameLi ? textOf(nameLi).split("Name :")[1] || "" : "";
      const fileSize = sizeLi ? textOf(sizeLi).split("Size :")[1] || "" : "";
      const quality = extractQuality(fileName);

      // Kotlin: div.text-center a
      const buttons = Array.from(doc.querySelectorAll("div.text-center a"));

      for (let bi = 0; bi < buttons.length; bi++) {        const anchor = buttons[bi];
        const txt = textOf(anchor).toLowerCase();
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
          // Kotlin: load(baseUrl+href), select div.card-body a
          try {
            const nested = await loadDoc(baseUrl + href);
            const dlink = nested.querySelector("div.card-body a");
            if (!dlink) continue;
            finalUrl = dlink.getAttribute("href");
            label = "[FAST CLOUD]";
          } catch (_) { continue; }
        } else if (href.includes("pixeldra")) {
          // Kotlin: getBaseUrl + api/file endpoint
          const base = (href.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
          finalUrl = href.includes("download") ? href : base + "/api/file/" + href.split("/").pop() + "?download";
          label = "[Pixeldrain]";
        } else if (txt.includes("instant dl")) {
          // Kotlin: redirect with allowRedirects=false, parse location header
          try {
            var opts = {};
            for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
            opts.allowRedirects = false;
            const r = await http_get(href, opts);
            const loc = r.headers && (r.headers["location"] || r.headers["Location"]) || "";
            const instant = loc.includes("url=") ? loc.split("url=")[1] : loc;
            if (instant) { finalUrl = instant; label = "[Instant]"; }
            else continue;
          } catch (_) { continue; }
        } else if (txt.includes("gofile")) {
          // Kotlin: recursive loadExtractor for GoFile
          streams.push(new StreamResult({ url: href, source: "Gofile" }));
          continue;
        } else {
          // Kotlin: Log.d("Error", "No Server matched")
          continue;
        }
        if (finalUrl && finalUrl.startsWith("http")) {
          // Kotlin ExtractorLink: source, name, url, referer, quality, isM3u8, headers
          streams.push(new StreamResult({
            url: finalUrl,
            source: "GDFlix" + label,
            quality: quality,
            headers: { "Referer": url, "User-Agent": UA }
          }));
        }
      }

      // Kotlin CF backup: CFType(newUrl.replace("file", "wfile"))
      try {
        const cfUrl = url.replace("/file/", "/wfile/");
        if (cfUrl !== url) {
          const cfDoc = await loadDoc(cfUrl);
          const cfBtns = cfDoc.querySelectorAll("a.btn-success");
          for (let ci = 0; ci < cfBtns.length; ci++) {
            const cfHref = cfBtns[ci].getAttribute("href");
            if (cfHref) {
              const resolved = await resolveFinalUrl(cfHref);
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

  async function extractFastDLServer(url, streams) {
    try {
      // Kotlin: redirect with allowRedirects=false
      var opts = {};
      for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
      opts.allowRedirects = false;
      const res = await http_get(url, opts);
      const location = res.headers && (res.headers["location"] || res.headers["Location"]);
      if (location) {
        // Kotlin: loadExtractor(location, ...)
        streams.push(new StreamResult({ url: location, source: "FastDL" }));
      }
    } catch (_) {}
  }
  async function loadGenericExtractor(url, streams) {
    const hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.includes("pixeldrain")) {
      const base = (url.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
      const final = url.includes("download") ? url : base + "/api/file/" + url.split("/").pop() + "?download";
      streams.push(new StreamResult({ url: final, source: "Pixeldrain" }));
    } else if (hostname.includes("gofile")) {
      streams.push(new StreamResult({ url: url, source: "Gofile" }));
    } else {
      // Passthrough for SkyStream built-in extractor handling
      streams.push(new StreamResult({ url: url, source: "Generic" }));
    }
  }

  // === CORE FUNCTIONS - LIBRARY CODE PRESERVED (Your working code) ===

  async function getHome(cb) {
    try {
      const sections = [
        { name: "Trending", path: "" },
        { name: "Bollywood Movies", path: "/movies/bollywood/" },
        { name: "Hollywood Movies", path: "/movies/hollywood/" },
        { name: "Anime", path: "/anime/" }
      ];

      const data = {};

      for (const section of sections) {
        try {
          const url = section.path ? manifest.baseUrl + section.path : manifest.baseUrl;
          const doc = await loadDoc(url);
          
          const items = Array.from(doc.querySelectorAll("div.post-cards > article"))
            .map(el => {
              const anchor = el.querySelector("a");
              if (!anchor) return null;
              
              const title = cleanTitle(anchor.getAttribute("title"));
              const href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
              const img = el.querySelector("img");
              const poster = img ? normalizeUrl(img.getAttribute("src"), manifest.baseUrl) : "";
              
              if (!title || !href) return null;
              
              return new MultimediaItem({
                title: title,
                url: href,
                posterUrl: poster,                type: "movie",
                contentType: "movie"
              });
            })
            .filter(Boolean);

          if (items.length > 0) {
            data[section.name] = uniqueByUrl(items).slice(0, 30);
          }
        } catch (err) {
          console.error("Error loading section " + section.name + ":", err);
          data[section.name] = [];
        }
      }

      cb({ success: true,  data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  async function search(query, cb) {
    try {
      const q = encodeURIComponent(String(query || "").trim());
      const page = 1;
      const url = manifest.baseUrl + "/search/" + q + "/page/" + page + "/";
      
      const doc = await loadDoc(url);
      const results = Array.from(doc.querySelectorAll("div.post-cards > article"))
        .map(el => {
          const anchor = el.querySelector("a");
          if (!anchor) return null;
          
          const title = cleanTitle(anchor.getAttribute("title"));
          const href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
          const img = el.querySelector("img");
          const poster = img ? normalizeUrl(img.getAttribute("src"), manifest.baseUrl) : "";
          
          if (!title || !href) return null;
          
          return new MultimediaItem({
            title: title,
            url: href,
            posterUrl: poster,
            type: "movie",
            contentType: "movie"
          });
        })
        .filter(Boolean);
      cb({ success: true,  uniqueByUrl(results).slice(0, 40) });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  async function load(url, cb) {
    try {
      const doc = await loadDoc(url);
      
      let title = cleanTitle(doc.querySelector("title") && doc.querySelector("title").textContent ? doc.querySelector("title").textContent : "");
      const ogImg = doc.querySelector("meta[property='og:image']");
      let posterUrl = ogImg ? normalizeUrl(ogImg.getAttribute("content"), manifest.baseUrl) : "";
      const summary = doc.querySelector("span#summary");
      let description = summary ? textOf(summary) : "";
      
      const isSeries = isSeriesUrl(url) || /series|web-series/i.test(title);
      const contentType = isSeries ? "series" : "movie";
      
      const imdbAnchor = doc.querySelector("div.imdb_left > a");
      const imdbUrl = imdbAnchor ? imdbAnchor.getAttribute("href") : "";
      let cinemetaData = null;
      
      if (imdbUrl) {
        const parts = imdbUrl.split("title/");
        if (parts.length > 1) {
          const imdbId = parts[1].split("/")[0];
          if (imdbId) {
            cinemetaData = await fetchCinemetaData(contentType === "series" ? "tv" : "movie", imdbId);
          }
        }
      }
      
      if (cinemetaData && cinemetaData.meta) {
        const meta = cinemetaData.meta;
        title = meta.name || title;
        description = meta.description || description;
        posterUrl = meta.poster || posterUrl;
        const bgPoster = meta.background || posterUrl;
        const genres = meta.genre || [];
        const cast = meta.cast || [];
        const imdbRating = meta.imdbRating || "";
        const year = meta.year ? parseInt(meta.year) : null;
        
        const actors = [];
        for (let ci = 0; ci < cast.length; ci++) {
          const c = cast[ci];
          const profilePath = c.profile_path || "";
          actors.push(new Actor({
            name: c.name || c,            role: c.role || c.character || "",
            image: c.image || (profilePath ? "https://image.tmdb.org/t/p/w500" + profilePath : null)
          }));
        }
        
        if (isSeries) {
          const episodesMap = new Map();
          const buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
          
          for (let bi = 0; bi < buttons.length; bi++) {
            const btn = buttons[bi];
            let link = btn.getAttribute("href");
            if (!link) continue;
            
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              const bypassed = await bypassProtectedLink(id);
              if (bypassed) link = bypassed;
            }
            
            const parent = btn.parentElement;
            const prevSibling = parent ? parent.previousElementSibling : null;
            const seasonText = prevSibling ? textOf(prevSibling) : "";
            const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
            const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
            
            try {
              const seasonDoc = await loadDoc(link);
              const epLinks = Array.from(seasonDoc.querySelectorAll("h3 > a"))
                .filter(a => !textOf(a).toLowerCase().includes("zip"));
              
              let epNum = 1;
              for (let ei = 0; ei < epLinks.length; ei++) {
                const epAnchor = epLinks[ei];
                const epUrl = epAnchor.getAttribute("href");
                if (!epUrl) continue;
                
                const videos = meta.videos || [];
                let epInfo = null;
                for (let vi = 0; vi < videos.length; vi++) {
                  const v = videos[vi];
                  if (v.season === seasonNum && v.episode === epNum) {
                    epInfo = v;
                    break;
                  }
                }
                
                const epData = {
                  url: epUrl,  // ← RAW URL STRING (CRITICAL FIX)
                  name: (epInfo && epInfo.name) || (epInfo && epInfo.title) || "Episode " + epNum,                  season: seasonNum,
                  episode: epNum,
                  posterUrl: (epInfo && epInfo.thumbnail) || posterUrl,
                  description: (epInfo && epInfo.overview) || ""
                };
                
                if (!episodesMap.has(seasonNum)) {
                  episodesMap.set(seasonNum, new Map());
                }
                episodesMap.get(seasonNum).set(epNum, epData);
                epNum++;
              }
            } catch (_) {}
          }
          
          const episodes = [];
          for (const [season, eps] of episodesMap) {
            for (const [epNum, epData] of eps) {
              // CRITICAL FIX: Episode.url = RAW URL STRING, NOT JSON.stringify
              episodes.push(new Episode({
                name: epData.name,
                url: epData.url,  // ← RAW STRING, matches Kotlin loadLinks(data: String)
                season: season,
                episode: epNum,
                posterUrl: epData.posterUrl,
                description: epData.description
              }));
            }
          }
          episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
          
          const fallbackEp = new Episode({
            name: title,
            url: url,  // ← RAW STRING
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          });
          
          const item = new MultimediaItem({
            title: title,
            url: url,
            posterUrl: posterUrl,
            bannerUrl: bgPoster,
            description: description,
            year: year,
            score: imdbRating ? parseFloat(imdbRating) * 10 : null,
            tags: genres,
            cast: actors,
            type: "series",            contentType: "series",
            episodes: episodes.length > 0 ? episodes : [fallbackEp]
          });
          
          cb({ success: true,  item });
          return;
        } else {
          const sources = [];
          const buttons = doc.querySelectorAll("a.dl");
          
          for (let bi = 0; bi < buttons.length; bi++) {
            const btn = buttons[bi];
            let link = btn.getAttribute("href");
            if (!link) continue;
            
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              const bypassed = await bypassProtectedLink(id);
              if (bypassed) link = bypassed;
            }
            sources.push(link);  // ← RAW URL STRING
          }
          
          const firstUrl = sources.length > 0 ? sources[0] : url;
          
          const item = new MultimediaItem({
            title: title,
            url: url,
            posterUrl: posterUrl,
            bannerUrl: bgPoster,
            description: description,
            year: year,
            score: imdbRating ? parseFloat(imdbRating) * 10 : null,
            tags: genres,
            cast: actors,
            type: "movie",
            contentType: "movie",
            episodes: [new Episode({
              name: title,
              url: firstUrl,  // ← RAW STRING, matches Kotlin
              season: 1,
              episode: 1,
              posterUrl: posterUrl
            })]
          });
          
          cb({ success: true,  item });
          return;
        }
      }      
      // Fallback without Cinemeta
      if (isSeries) {
        const episodes = [];
        const buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
        let epNum = 1;
        
        for (let bi = 0; bi < buttons.length; bi++) {
          const btn = buttons[bi];
          let link = btn.getAttribute("href");
          if (!link) continue;
          
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            const bypassed = await bypassProtectedLink(id);
            if (bypassed) link = bypassed;
          }
          
          const parent = btn.parentElement;
          const prevSibling = parent ? parent.previousElementSibling : null;
          const seasonText = prevSibling ? textOf(prevSibling) : "";
          const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
          const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          
          episodes.push(new Episode({
            name: "Episode " + epNum,
            url: link,  // ← RAW STRING
            season: seasonNum,
            episode: epNum,
            posterUrl: posterUrl
          }));
          epNum++;
        }
        
        const fallbackEp = new Episode({
          name: title,
          url: url,  // ← RAW STRING
          season: 1,
          episode: 1,
          posterUrl: posterUrl
        });
        
        const item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: posterUrl,
          description: description,
          type: "series",
          contentType: "series",
          episodes: episodes.length > 0 ? episodes : [fallbackEp]        });
        
        cb({ success: true,  item });
      } else {
        const sources = [];
        const buttons = doc.querySelectorAll("a.dl");
        for (let bi = 0; bi < buttons.length; bi++) {
          const btn = buttons[bi];
          let link = btn.getAttribute("href");
          if (!link) continue;
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            const bypassed = await bypassProtectedLink(id);
            if (bypassed) link = bypassed;
          }
          sources.push(link);
        }
        const firstUrl = sources.length > 0 ? sources[0] : url;
        
        const item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: posterUrl,
          description: description,
          type: "movie",
          contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: firstUrl,  // ← RAW STRING
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          })]
        });
        
        cb({ success: true,  item });
      }
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  // === loadStreams - FIXED: Exact Kotlin loadLinks pattern ===
  async function loadStreams(data, cb) {
    try {
      // CRITICAL FIX: data is RAW URL STRING (matches Kotlin loadLinks(data: String))
      const url = String(data || "").trim();
      
      if (!url || !url.startsWith("http")) {
        return cb({ success: true, data: [] });      }
      
      const streams = [];
      const srcStr = url.toLowerCase();
      
      // EXACT Kotlin routing: source.contains("gdflix") || source.contains("gdlink")
      if (srcStr.includes("gdflix") || srcStr.includes("gdlink")) {
        await extractGDFlix(url, streams);
      } else if (srcStr.includes("fastdlserver")) {
        await extractFastDLServer(url, streams);
      } else {
        await loadGenericExtractor(url, streams);
      }
      
      // Deduplicate by URL
      const seen = new Set();
      const results = [];
      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];
        if (!s || !s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        results.push(s);
      }
      
      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  // === EXPORTS ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
