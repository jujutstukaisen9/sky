(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * Migrated from CloudStream Kotlin Provider
   * Supports: Movies, TV Series, Anime, Asian Dramas
   */

  // === CONFIGURATION ===
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const CINEMETA_URL = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UTILS_URL = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": `${manifest.baseUrl}/`
  };

  // === HELPER FUNCTIONS ===

  function normalizeUrl(url, base) {
    if (!url) return "";
    const raw = String(url).trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return `https:${raw}`;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return `${base}${raw}`;
    return `${base}/${raw}`;
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
    return /series|web-series|season/i.test(String(url));  }

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
      .replace(/&/g, "&").replace(/"/g, '"').replace(/'/g, "'")
      .replace(/</g, "<").replace(/>/g, ">")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  }

  function textOf(el) {
    return htmlDecode((el?.textContent || "").replace(/\s+/g, " ").trim());
  }

  function getAttr(el, ...attrs) {
    if (!el) return "";
    for (const attr of attrs) {
      const v = el.getAttribute(attr);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  // === NETWORK UTILS ===

  async function request(url, headers = {}) {
    return await http_get(url, { headers: { ...BASE_HEADERS, ...headers } });
  }
  function isCloudflareBlocked(response, targetUrl) {
    const body = String(response?.body || "");
    const headerServer = (response?.headers?.["server"] || "").toLowerCase();
    const title = (body.match(/<title>([^<]*)</i)?.[1] || "").toLowerCase();
    
    if (/cloudflare/i.test(body) && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
    if (title.includes("just a moment") || title.includes("attention required")) return true;
    if (headerServer.includes("cloudflare") && /checking your browser|verify you are human/i.test(body)) return true;
    if (String(targetUrl || "").includes("/cdn-cgi/challenge-platform/")) return true;
    return false;
  }

  async function loadDoc(url, headers = {}) {
    const res = await request(url, headers);
    const finalUrl = String(res?.finalUrl || res?.url || url || "");
    
    if (isCloudflareBlocked(res, finalUrl)) {
      throw new Error(`CLOUDFLARE_BLOCKED: ${finalUrl}`);
    }
    return await parseHtml(res.body);
  }

  async function fetchDynamicBaseUrl(source) {
    try {
      const res = await request(UTILS_URL, {}, true);
      const urls = JSON.parse(res.body);
      return urls?.[source]?.trim() || null;
    } catch (_) {
      return null;
    }
  }

  async function fetchCinemetaData(type, imdbId) {
    try {
      const url = `${CINEMETA_URL}/${type}/${imdbId}.json`;
      const res = await request(url, { "Accept": "application/json" }, true);
      return JSON.parse(res.body);
    } catch (_) {
      return null;
    }
  }

  // === BYPASS PROTECTED LINKS ===

  async function bypassProtectedLink(id) {
    try {
      const url = `https://web.sidexfee.com/?id=${id}`;
      const res = await request(url, {}, true);
      const body = String(res.body || "");      const match = body.match(/"link":"([^"]+)"/);
      if (match && match[1]) {
        return safeBase64Decode(match[1].replace(/\\\//g, "/"));
      }
    } catch (_) {}
    return null;
  }

  async function resolveFinalUrl(startUrl, maxRedirects = 7) {
    let currentUrl = startUrl;
    for (let i = 0; i < maxRedirects; i++) {
      try {
        const res = await request(currentUrl, {}, false);
        if (res.code === 200) break;
        if (res.code >= 300 && res.code < 400) {
          const location = res.headers?.["location"] || res.headers?.["Location"];
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

  // === EXTRACTORS ===

  async function extractGDFlix(url, fileName = "", fileSize = "") {
    try {
      let baseUrl = url.match(/^https?:\/\/[^/]+/)?.[0] || "";
      const dynamicBase = await fetchDynamicBaseUrl("gdflix");
      if (dynamicBase && baseUrl !== dynamicBase) {
        url = url.replace(baseUrl, dynamicBase);
        baseUrl = dynamicBase;
      }

      const doc = await loadDoc(url);
      const name = fileName || doc.querySelector("ul > li:contains(Name)")?.textContent?.split("Name :")?.[1]?.trim() || "";
      const size = fileSize || doc.querySelector("ul > li:contains(Size)")?.textContent?.split("Size :")?.[1]?.trim() || "";
      const quality = extractQuality(name);

      const results = [];
      const buttons = doc.querySelectorAll("div.text-center a, a.btn-success");

      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || "";
        const href = btn.getAttribute("href");        if (!href) continue;

        let label = "GDFlix";
        let finalUrl = href;

        if (text.includes("fsl v2")) {
          label = "GDFlix [FSL V2]";
        } else if (text.includes("direct") || text.includes("instant")) {
          label = "GDFlix [Direct]";
          if (text.includes("instant")) {
            const redir = await resolveFinalUrl(href);
            if (redir) finalUrl = redir;
          }
        } else if (text.includes("cloud") || text.includes("r2")) {
          label = "GDFlix [Cloud]";
        } else if (text.includes("fast cloud")) {
          const nestedDoc = await loadDoc(`${baseUrl}${href}`);
          const nestedLink = nestedDoc.querySelector("div.card-body a")?.getAttribute("href");
          if (nestedLink) finalUrl = nestedLink;
          label = "GDFlix [FAST CLOUD]";
        } else if (href.includes("pixeldra")) {
          label = "GDFlix [Pixeldrain]";
          const base = href.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
          finalUrl = href.includes("download") ? href : `${base}/api/file/${href.split("/").pop()}?download`;
        } else if (text.includes("gofile")) {
          const delegated = await loadGenericExtractor(href);
          results.push(...delegated);
          continue;
        }

        if (finalUrl && finalUrl.startsWith("http")) {
          results.push(new StreamResult({
            source: label,
            name: `${label} ${name ? `[${name}]` : ""} ${size ? `[${size}]` : ""}`.trim(),
            url: finalUrl,
            quality: quality,
            headers: { "Referer": url, "User-Agent": UA }
          }));
        }
      }

      // Cloudflare backup links
      try {
        const cfTypes = ["1", "2"];
        for (const t of cfTypes) {
          const cfDoc = await loadDoc(`${url}?type=${t}`);
          const cfLinks = cfDoc.querySelectorAll("a.btn-success");
          for (const lnk of cfLinks) {
            const cfHref = lnk.getAttribute("href");
            if (cfHref) {              const resolved = await resolveFinalUrl(cfHref);
              if (resolved) {
                results.push(new StreamResult({
                  source: "GDFlix [CF]",
                  name: `GDFlix [CF] ${name ? `[${name}]` : ""}`,
                  url: resolved,
                  quality: quality,
                  headers: { "Referer": url, "User-Agent": UA }
                }));
              }
            }
          }
        }
      } catch (_) {}

      return results;
    } catch (_) {
      return [];
    }
  }

  async function extractFastDLServer(url) {
    try {
      const res = await request(url, {}, false);
      const location = res.headers?.["location"] || res.headers?.["Location"];
      if (location) {
        return await loadGenericExtractor(location);
      }
    } catch (_) {}
    return [];
  }

  async function loadGenericExtractor(url) {
    const hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.includes("pixeldrain")) {
      const base = url.match(/^https?:\/\/[^/]+/)?.[0] || "https://pixeldrain.com";
      const finalUrl = url.includes("download") ? url : `${base}/api/file/${url.split("/").pop()}?download`;
      return [new StreamResult({
        source: "Pixeldrain",
        url: finalUrl,
        headers: { "Referer": url, "User-Agent": UA }
      })];
    }

    if (hostname.includes("gofile")) {
      return [new StreamResult({
        source: "Gofile",
        url: url,
        headers: { "Referer": url, "User-Agent": UA }      })];
    }

    return [new StreamResult({
      source: "Generic",
      url: url,
      headers: { "Referer": url, "User-Agent": UA }
    })];
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

      for (const section of sections) {
        try {
          const url = section.path ? `${manifest.baseUrl}${section.path}` : manifest.baseUrl;
          const doc = await loadDoc(url);
          
          const items = Array.from(doc.querySelectorAll("div.post-cards > article"))
            .map(el => {
              const anchor = el.querySelector("a");
              if (!anchor) return null;
              
              const title = cleanTitle(anchor.getAttribute("title"));
              const href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
              const poster = normalizeUrl(el.querySelector("img")?.getAttribute("src"), manifest.baseUrl);
              
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

          if (items.length > 0) {            data[section.name] = uniqueByUrl(items).slice(0, 30);
          }
        } catch (err) {
          console.error(`Error loading section ${section.name}:`, err);
          data[section.name] = [];
        }
      }

      cb({ success: true, data: data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
    }
  }

  async function search(query, cb) {
    try {
      const q = encodeURIComponent(String(query || "").trim());
      const page = 1;
      const url = `${manifest.baseUrl}/search/${q}/page/${page}/`;
      
      const doc = await loadDoc(url);
      const results = Array.from(doc.querySelectorAll("div.post-cards > article"))
        .map(el => {
          const anchor = el.querySelector("a");
          if (!anchor) return null;
          
          const title = cleanTitle(anchor.getAttribute("title"));
          const href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
          const poster = normalizeUrl(el.querySelector("img")?.getAttribute("src"), manifest.baseUrl);
          
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

      cb({ success: true, data: uniqueByUrl(results).slice(0, 40) });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
    }
  }

  async function load(url, cb) {
    try {      const doc = await loadDoc(url);
      
      let title = cleanTitle(doc.querySelector("title")?.textContent);
      let posterUrl = normalizeUrl(doc.querySelector("meta[property='og:image']")?.getAttribute("content"), manifest.baseUrl);
      let description = doc.querySelector("span#summary")?.textContent?.trim() || "";
      
      const isSeries = isSeriesUrl(url) || /series|web-series/i.test(title);
      const contentType = isSeries ? "series" : "movie";
      
      const imdbAnchor = doc.querySelector("div.imdb_left > a");
      const imdbUrl = imdbAnchor?.getAttribute("href");
      let cinemetaData = null;
      
      if (imdbUrl) {
        const imdbId = imdbUrl.split("title/")?.[1]?.split("/")?.[0];
        if (imdbId) {
          cinemetaData = await fetchCinemetaData(contentType === "series" ? "tv" : "movie", imdbId);
        }
      }
      
      if (cinemetaData?.meta) {
        const meta = cinemetaData.meta;
        title = meta.name || title;
        description = meta.description || description;
        posterUrl = meta.poster || posterUrl;
        const bgPoster = meta.background || posterUrl;
        const genres = meta.genre || [];
        const cast = meta.cast || [];
        const imdbRating = meta.imdbRating || "";
        const year = meta.year ? parseInt(meta.year) : null;
        
        const actors = cast.map(c => new Actor({
          name: c.name || c,
          role: c.role || c.character || "",
          image: c.image || c.profile_path ? `https://image.tmdb.org/t/p/w500${c.profile_path}` : null
        }));
        
        if (isSeries) {
          const episodesMap = new Map();
          const buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
          
          for (const btn of buttons) {
            let link = btn.getAttribute("href");
            if (!link) continue;
            
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              link = await bypassProtectedLink(id) || link;
            }
                        const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
            const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
            const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
            
            try {
              const seasonDoc = await loadDoc(link);
              const epLinks = seasonDoc.querySelectorAll("h3 > a")
                .filter(a => !a.textContent.toLowerCase().includes("zip"));
              
              let epNum = 1;
              for (const epAnchor of epLinks) {
                const epUrl = epAnchor.getAttribute("href");
                if (!epUrl) continue;
                
                const epInfo = cinemetaData.meta?.videos?.find(v => 
                  v.season === seasonNum && v.episode === epNum
                );
                
                const epData = {
                  url: epUrl,
                  name: epInfo?.name || epInfo?.title || `Episode ${epNum}`,
                  season: seasonNum,
                  episode: epNum,
                  posterUrl: epInfo?.thumbnail || posterUrl,
                  description: epInfo?.overview || ""
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
              episodes.push(new Episode({
                name: epData.name,
                url: JSON.stringify([{ url: epData.url, source: "primary" }]),
                season: season,
                episode: epNum,
                posterUrl: epData.posterUrl,
                description: epData.description
              }));
            }
          }
                    episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
          
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
            type: "series",
            contentType: "series",
            episodes: episodes.length > 0 ? episodes : [new Episode({
              name: title,
              url: JSON.stringify([{ url: url, source: "primary" }]),
              season: 1,
              episode: 1,
              posterUrl: posterUrl
            })]
          });
          
          cb({ success: true, data: item });
          return;
        } else {
          const sources = [];
          const buttons = doc.querySelectorAll("a.dl");
          
          for (const btn of buttons) {
            let link = btn.getAttribute("href");
            if (!link) continue;
            
            if (link.includes("id=")) {
              const id = link.split("id=").pop();
              link = await bypassProtectedLink(id) || link;
            }
            sources.push({ url: link, source: "primary" });
          }
          
          const item = new MultimediaItem({
            title: title,
            url: url,
            posterUrl: posterUrl,
            bannerUrl: bgPoster,
            description: description,
            year: year,
            score: imdbRating ? parseFloat(imdbRating) * 10 : null,
            tags: genres,
            cast: actors,            type: "movie",
            contentType: "movie",
            episodes: [new Episode({
              name: title,
              url: JSON.stringify(sources),
              season: 1,
              episode: 1,
              posterUrl: posterUrl
            })]
          });
          
          cb({ success: true, data: item });
          return;
        }
      }
      
      // Fallback without Cinemeta
      if (isSeries) {
        const episodes = [];
        const buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
        let epNum = 1;
        
        for (const btn of buttons) {
          let link = btn.getAttribute("href");
          if (!link) continue;
          
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            link = await bypassProtectedLink(id) || link;
          }
          
          const seasonText = btn.parentElement?.previousElementSibling?.textContent || "";
          const seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
          const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          
          episodes.push(new Episode({
            name: `Episode ${epNum}`,
            url: JSON.stringify([{ url: link, source: "primary" }]),
            season: seasonNum,
            episode: epNum,
            posterUrl: posterUrl
          }));
          epNum++;
        }
        
        const item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: posterUrl,
          description: description,          type: "series",
          contentType: "series",
          episodes: episodes.length > 0 ? episodes : [new Episode({
            name: title,
            url: JSON.stringify([{ url: url, source: "primary" }]),
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          })]
        });
        
        cb({ success: true, data: item });
      } else {
        const sources = [];
        const buttons = doc.querySelectorAll("a.dl");
        for (const btn of buttons) {
          let link = btn.getAttribute("href");
          if (!link) continue;
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            link = await bypassProtectedLink(id) || link;
          }
          sources.push({ url: link, source: "primary" });
        }
        
        const item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: posterUrl,
          description: description,
          type: "movie",
          contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: JSON.stringify(sources),
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          })]
        });
        
        cb({ success: true, data: item });
      }
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
    }
  }

  async function loadStreams(data, cb) {
    try {      let sources = [];
      if (typeof data === "string") {
        try {
          sources = JSON.parse(data);
        } catch (_) {
          sources = [{ url: data, source: "primary" }];
        }
      } else if (Array.isArray(data)) {
        sources = data;
      } else if (data?.url) {
        sources = typeof data.url === "string" && data.url.startsWith("[") 
          ? JSON.parse(data.url) 
          : [{ url: data.url, source: "primary" }];
      }
      
      if (!sources || sources.length === 0) {
        return cb({ success: true, data: [] });
      }
      
      const results = [];
      const seen = new Set();
      
      for (const src of sources) {
        const url = src.url || src;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        
        const hostname = new URL(url).hostname.toLowerCase();
        let streams = [];
        
        if (hostname.includes("gdflix") || hostname.includes("gdlink")) {
          streams = await extractGDFlix(url, src.name || "", src.size || "");
        } else if (hostname.includes("fastdlserver")) {
          streams = await extractFastDLServer(url);
        } else {
          streams = await loadGenericExtractor(url);
        }
        
        for (const stream of streams) {
          if (!seen.has(stream.url)) {
            seen.add(stream.url);
            results.push(stream);
          }
        }
      }
      
      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
    }  }

  // === EXPORT CORE FUNCTIONS ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
