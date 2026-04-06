(function() {
  // manifest is injected at runtime

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${manifest.baseUrl}/`
  };

  // --- Helpers ---
  function normalizeUrl(url, base = manifest.baseUrl) {
    if (!url) return "";
    const raw = String(url).trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return `https:${raw}`;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return `${base}${raw}`;
    return `${base}/${raw}`;
  }

  function htmlDecode(text) {
    if (!text) return "";
    return String(text)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
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

  function cleanTitle(raw) {
    let t = htmlDecode(String(raw || "")).replace(/\s+/g, " ").trim();
    t = t.replace(/\s*[\(\[]?(?:480p|720p|1080p|4K|HDRip|WEB-DL|BluRay|HEVC|x264|x265|AAC|DD5\.1|ESub)[\)\]]?\s*/gi, "");
    return t.trim() || "Unknown";  }

  function extractQuality(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("2160") || t.includes("4k") || t.includes("ultra")) return "4K";
    if (t.includes("1080") || t.includes("full")) return "1080p";
    if (t.includes("1440") || t.includes("quad")) return "1440p";
    if (t.includes("720") || t.includes("hd")) return "720p";
    if (t.includes("480") || t.includes("sd")) return "480p";
    if (t.includes("360") || t.includes("low")) return "360p";
    return "Auto";
  }

  function safeAtob(str) {
    if (!str) return "";
    try {
      let s = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) {
      try { return atob(str); } catch (__) { return ""; }
    }
  }

  function isCloudflare(body) {
    const b = String(body || "").toLowerCase();
    return /cloudflare|checking your browser|just a moment|cf-ray|cf-chl/i.test(b);
  }

  // --- Network with retry ---
  async function request(url, headers = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await http_get(url, { 
          headers: Object.assign({}, BASE_HEADERS, headers),
          timeout: 15000 
        });
        if (isCloudflare(res.body)) {
          if (i < retries) {
            await new Promise(r => setTimeout(r, 2000 + i * 1000));
            continue;
          }
          throw new Error("CLOUDFLARE_BLOCKED");
        }
        return res;
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 1500 + i * 1000));
      }
    }  }

  async function loadDoc(url, headers = {}) {
    const res = await request(url, headers);
    return await parseHtml(res.body);
  }

  // --- Parsers ---
  function parseItemFromCard(el, baseUrl) {
    if (!el) return null;
    
    // Multiple selector attempts for poster links
    const anchor = el.querySelector("a[href*='loanid.php'], a[href*='/movie/'], a[href*='/series/'], .poster a, .thumb a");
    if (!anchor) return null;
    
    const href = normalizeUrl(getAttr(anchor, "href"), baseUrl);
    if (!href) return null;
    
    const img = el.querySelector("img");
    const posterUrl = normalizeUrl(getAttr(img, "src", "data-src", "data-original"), baseUrl);
    
    // Title from multiple sources
    let title = getAttr(anchor, "title") || 
                getAttr(img, "alt") || 
                textOf(el.querySelector(".title, .movie-title, h3, h4, .entry-title, a")) ||
                "Unknown";
    title = cleanTitle(title);
    if (!title || title === "Unknown") return null;
    
    // Year extraction
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
    
    // Type detection
    const typeText = textOf(el.querySelector(".type, .badge, .label, .cat"))?.toLowerCase() || "";
    const type = typeText.includes("series") || typeText.includes("episode") || typeText.includes("drama") ? "series" : "movie";
    
    return new MultimediaItem({
      title,
      url: href,
      posterUrl: posterUrl,
      type,
      year,
      contentType: type
    });
  }

  // --- Core Functions ---
  async function getHome(cb) {
    try {      const sections = [
        { name: "Trending", path: "/" },
        { name: "Latest", path: "/" },
        { name: "Movies", path: "/movies/" },
        { name: "Series", path: "/series/" }
      ];

      const data = {};
      for (const sec of sections) {
        try {
          const url = `${manifest.baseUrl}${sec.path}`;
          const doc = await loadDoc(url);
          
          // Flexible card selectors - adjust based on actual site
          const selectors = [
            "div.movie-card", "article", ".post", ".item", 
            "a[href*='loanid.php']", ".thumb", ".poster", 
            ".list-item", ".film-item", ".video-item"
          ];
          
          let items = [];
          for (const sel of selectors) {
            const cards = doc.querySelectorAll(sel);
            if (cards.length > 0) {
              items = Array.from(cards)
                .map(el => parseItemFromCard(el, manifest.baseUrl))
                .filter(Boolean);
              if (items.length > 0) break;
            }
          }
          
          if (items.length > 0) {
            data[sec.name] = items.slice(0, 24);
          }
        } catch (e) {
          console.error(`Section [${sec.name}] failed: ${e.message}`);
        }
      }

      // ✅ CRITICAL: Return with 'data' key
      cb({ success: true, data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
    }
  }

  async function search(query, cb) {
    try {
      const encoded = encodeURIComponent(query);
      const urls = [        `${manifest.baseUrl}/search?q=${encoded}`,
        `${manifest.baseUrl}/?s=${encoded}`,
        `${manifest.baseUrl}/search.php?q=${encoded}`,
        `${manifest.baseUrl}/search/${encoded}`
      ];
      
      let items = [];
      for (const url of urls) {
        try {
          const doc = await loadDoc(url);
          const selectors = [
            "div.movie-card", "article", ".post", ".item", 
            "a[href*='loanid.php']", ".thumb", ".poster"
          ];
          
          for (const sel of selectors) {
            const cards = doc.querySelectorAll(sel);
            if (cards.length > 0) {
              items = Array.from(cards)
                .map(el => parseItemFromCard(el, manifest.baseUrl))
                .filter(Boolean);
              if (items.length > 0) break;
            }
          }
          if (items.length > 0) break;
        } catch (_) {}
      }
      
      // ✅ CRITICAL: Return with 'data' key
      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
    }
  }

  async function load(url, cb) {
    try {
      const doc = await loadDoc(url);
      
      // Title
      const titleEl = doc.querySelector("h1, .title, .movie-title, h2.entry-title, .post-title");
      const title = cleanTitle(textOf(titleEl));
      
      // Poster
      const posterEl = doc.querySelector("img.poster, .poster img, meta[property='og:image'], .entry-image img");
      let posterUrl = normalizeUrl(getAttr(posterEl, "src", "content", "data-src"), manifest.baseUrl);
      
      // Description
      const descEl = doc.querySelector(".description, .desc, .plot, .entry-content p:first-child, meta[name='description']");
      const description = textOf(descEl) || "";      
      // Quality links - look for loanagreement.php links
      const episodes = [];
      const qualityLinks = doc.querySelectorAll("a[href*='loanagreement.php'], .quality-btn, .download-btn, [data-quality], .server-option");
      
      if (qualityLinks.length > 0) {
        qualityLinks.forEach((link, idx) => {
          const qualityHref = normalizeUrl(getAttr(link, "href"), manifest.baseUrl);
          if (!qualityHref) return;
          
          let qualityLabel = textOf(link) || getAttr(link, "data-quality") || `Quality ${idx + 1}`;
          qualityLabel = extractQuality(qualityLabel);
          
          episodes.push(new Episode({
            name: `${qualityLabel} Quality`,
            url: qualityHref,
            season: 1,
            episode: idx + 1,
            posterUrl,
            dubStatus: "none"
          }));
        });
      } else {
        // Fallback: use detail page URL itself
        episodes.push(new Episode({
          name: "Stream",
          url: url,
          season: 1,
          episode: 1,
          posterUrl
        }));
      }
      
      const item = new MultimediaItem({
        title,
        url,
        posterUrl,
        description: description.slice(0, 500),
        type: episodes.length > 1 ? "series" : "movie",
        contentType: "movie",
        episodes: episodes.reverse()
      });
      
      // ✅ CRITICAL: Return with 'data' key
      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
    }
  }
  async function loadStreams(url, cb) {
    try {
      const doc = await loadDoc(url);
      const streams = [];
      const seenUrls = new Set();
      const html = doc.documentElement?.outerHTML || "";
      
      // Pattern 1: Direct CDN URLs in source
      const cdnPatterns = [
        /https?:\/\/[^\s"'<>]+\.cdn[^\/]*\.[^\s"'<>]+\.(?:mkv|mp4|m3u8|ts)/gi,
        /https?:\/\/cdn\.[^\s"'<>]+\.[^\s"'<>]+\.(?:mkv|mp4|m3u8|ts)/gi,
        /https?:\/\/[^\s"'<>]*cdn[^\s"'<>]*\.[^\s"'<>]+\.(?:mkv|mp4|m3u8|ts)/gi
      ];
      
      for (const pattern of cdnPatterns) {
        const matches = html.match(pattern) || [];
        for (const match of matches) {
          const videoUrl = match.trim();
          if (!videoUrl || seenUrls.has(videoUrl)) continue;
          seenUrls.add(videoUrl);
          
          const quality = extractQuality(videoUrl);
          streams.push(new StreamResult({
            url: videoUrl,
            quality: quality,
            source: "Direct CDN",
            headers: {
              "Referer": `${manifest.baseUrl}/`,
              "User-Agent": UA,
              "Origin": manifest.baseUrl
            }
          }));
        }
      }
      
      // Pattern 2: Links to actual video files
      const streamLinks = doc.querySelectorAll("a[href*='.mkv'], a[href*='.mp4'], a[href*='.m3u8'], .stream-btn, .play-btn");
      for (const link of streamLinks) {
        const streamUrl = normalizeUrl(getAttr(link, "href"), manifest.baseUrl);
        if (!streamUrl || streamUrl.includes(manifest.baseUrl) || seenUrls.has(streamUrl)) continue;
        seenUrls.add(streamUrl);
        
        const quality = extractQuality(textOf(link) || streamUrl);
        streams.push(new StreamResult({
          url: streamUrl,
          quality: quality,
          source: "Stream Link",
          headers: { "Referer": url, "User-Agent": UA }
        }));
      }      
      // Pattern 3: Embedded players
      const players = doc.querySelectorAll("video source, iframe[src*='cdn'], embed[src*='cdn']");
      for (const player of players) {
        const src = normalizeUrl(getAttr(player, "src", "data-src", "data-url"), manifest.baseUrl);
        if (!src || (!src.includes(".mkv") && !src.includes(".mp4") && !src.includes(".m3u8")) || seenUrls.has(src)) continue;
        seenUrls.add(src);
        
        const quality = extractQuality(src);
        streams.push(new StreamResult({
          url: src,
          quality: quality,
          source: "Embedded Player",
          headers: { "Referer": url, "User-Agent": UA }
        }));
      }
      
      // Pattern 4: Decode lid parameter if it contains base64 URL
      if (streams.length === 0) {
        const lidMatch = url.match(/[?&]lid=([^&]+)/);
        if (lidMatch) {
          try {
            const decoded = safeAtob(lidMatch[1]);
            if (decoded && (decoded.includes(".mkv") || decoded.includes(".mp4") || decoded.includes("http"))) {
              streams.push(new StreamResult({
                url: decoded,
                quality: extractQuality(decoded),
                source: "Decoded ID",
                headers: { "Referer": manifest.baseUrl, "User-Agent": UA }
              }));
            }
          } catch (_) {}
        }
      }
      
      // Sort by quality
      const qualityOrder = { "4K": 4, "1440p": 3, "1080p": 2, "720p": 1, "480p": 0, "360p": -1, "Auto": -2 };
      streams.sort((a, b) => (qualityOrder[b.quality] || -3) - (qualityOrder[a.quality] || -3));
      
      // ✅ CRITICAL: Return with 'data' key
      cb({ success: true, data: streams });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
    }
  }

  // --- Export ---
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;  globalThis.loadStreams = loadStreams;
})();
