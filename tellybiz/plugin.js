(function() {
  /**
   * TellyBiz Plugin for SkyStream
   * Scrapes movies and TV shows from tellybiz.in
   */

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  
  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${manifest.baseUrl}/`
  };

  // --- Helper Functions ---

  function normalizeUrl(url, base) {
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
      .replace(/&#39;/g, "'")
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

  function extractQuality(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("2160") || t.includes("4k") || t.includes("ultra")) return "2160p";
    if (t.includes("1080") || t.includes("full")) return "1080p";
    if (t.includes("720") || t.includes("hd")) return "720p";
    if (t.includes("480") || t.includes("sd")) return "480p";
    if (t.includes("360")) return "360p";
    return "Auto";
  }

  // --- Network Helpers ---

  async function request(url, headers = {}) {
    return http_get(url, { headers: Object.assign({}, BASE_HEADERS, headers) });
  }

  async function loadDoc(url, headers = {}) {
    const res = await request(url, headers);
    return await parseHtml(res.body);
  }

  // --- Parsers ---

  function parseMovieItem(el) {
    if (!el) return null;

    // Try multiple selectors for the link
    const anchor = el.querySelector("a[href*='loanid.php']") || 
                   el.querySelector("a.movie-link") || 
                   el.querySelector("a[href*='/lid=']") ||
                   el.querySelector("a");

    const href = getAttr(anchor, "href");
    if (!href) return null;

    // Extract title from various possible sources
    const title = textOf(el.querySelector(".title, .movie-title, h2, h3, .entry-title")) || 
                  getAttr(anchor, "title") ||
                  getAttr(el.querySelector("img"), "alt");

    if (!title || title === "Unknown") return null;

    // Extract poster image
    const img = el.querySelector("img");
    let posterUrl = getAttr(img, "data-src", "data-original", "src");
    posterUrl = normalizeUrl(posterUrl, manifest.baseUrl);

    // Determine type (movie or series)
    let type = "movie";
    const typeText = textOf(el).toLowerCase();
    if (typeText.includes("season") || typeText.includes("series") || typeText.includes("episode")) {
      type = "series";
    }

    return new MultimediaItem({
      title: title.replace(/Watch Online|Download|Free/gi, "").trim(),
      url: normalizeUrl(href, manifest.baseUrl),
      posterUrl: posterUrl,
      type: type,
      contentType: type
    });
  }

  // --- Core Functions ---

  async function getHome(cb) {
    try {
      const sections = [
        { name: "Trending", path: "/" },
        { name: "Latest Movies", path: "/movies/" },
        { name: "Latest Series", path: "/series/" },
        { name: "Bollywood", path: "/category/bollywood/" },
        { name: "Hollywood", path: "/category/hollywood/" },
        { name: "South Indian", path: "/category/south-indian/" },
        { name: "Web Series", path: "/category/web-series/" }
      ];

      const data = {};
      
      for (const sec of sections) {
        try {
          const url = sec.path === "/" ? manifest.baseUrl : `${manifest.baseUrl}${sec.path}`;
          const doc = await loadDoc(url);
          
          // Try multiple selectors for movie containers
          const selectors = [
            ".movie-item", ".post-item", ".item", "article", 
            ".movie", ".card", ".content-item", ".thumb"
          ];
          
          let items = [];
          for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
              items = Array.from(elements)
                .map(parseMovieItem)
                .filter(Boolean);
              if (items.length > 0) break;
            }
          }

          // Fallback: look for any links containing loanid.php
          if (items.length === 0) {
            const allLinks = doc.querySelectorAll("a[href*='loanid.php']");
            items = Array.from(allLinks)
              .map(a => {
                const container = a.closest("div, article, li") || a.parentElement;
                return parseMovieItem(container);
              })
              .filter(Boolean);
          }

          if (items.length > 0) {
            // Remove duplicates
            const seen = new Set();
            const uniqueItems = items.filter(item => {
              if (seen.has(item.url)) return false;
              seen.add(item.url);
              return true;
            });
            
            data[sec.name] = uniqueItems.slice(0, 24);
          }
        } catch (e) {
          console.error(`Error loading section ${sec.name}:`, e);
        }
      }

      cb({ success: true, data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
    }
  }

  async function search(query, cb) {
    try {
      const encodedQuery = encodeURIComponent(query);
      // Try common search URL patterns
      const searchUrls = [
        `${manifest.baseUrl}/search?q=${encodedQuery}`,
        `${manifest.baseUrl}/?s=${encodedQuery}`,
        `${manifest.baseUrl}/search/${encodedQuery}/`
      ];

      let allItems = [];
      
      for (const searchUrl of searchUrls) {
        try {
          const doc = await loadDoc(searchUrl);
          
          const selectors = [
            ".movie-item", ".post-item", ".item", "article", 
            ".movie", ".card", ".result-item"
          ];
          
          for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
              const items = Array.from(elements)
                .map(parseMovieItem)
                .filter(Boolean);
              allItems.push(...items);
            }
          }

          // Fallback to loanid links
          if (allItems.length === 0) {
            const links = doc.querySelectorAll("a[href*='loanid.php']");
            const items = Array.from(links)
              .map(a => parseMovieItem(a.closest("div, article, li") || a.parentElement))
              .filter(Boolean);
            allItems.push(...items);
          }

          if (allItems.length > 0) break;
        } catch (e) {}
      }

      // Remove duplicates and score results
      const seen = new Set();
      const uniqueItems = allItems.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });

      // Simple scoring based on title match
      const queryLower = query.toLowerCase();
      uniqueItems.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const aScore = aTitle.includes(queryLower) ? (aTitle.startsWith(queryLower) ? 2 : 1) : 0;
        const bScore = bTitle.includes(queryLower) ? (bTitle.startsWith(queryLower) ? 2 : 1) : 0;
        return bScore - aScore;
      });

      cb({ success: true, data: uniqueItems });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
    }
  }

  async function load(url, cb) {
    try {
      const doc = await loadDoc(url);
      
      // Extract title
      let title = textOf(doc.querySelector("h1, .title, .movie-title, .entry-title"));
      if (!title) {
        title = textOf(doc.querySelector("meta[property='og:title']")) || "Unknown Title";
      }
      title = title.replace(/Watch Online|Download|Free/gi, "").trim();

      // Extract poster
      let posterUrl = getAttr(doc.querySelector(".poster img, .movie-poster img, .featured-image img"), "src", "data-src");
      if (!posterUrl) {
        posterUrl = getAttr(doc.querySelector("meta[property='og:image']"), "content");
      }
      posterUrl = normalizeUrl(posterUrl, manifest.baseUrl);

      // Extract description
      let description = textOf(doc.querySelector(".description, .synopsis, .plot, .entry-content p"));
      if (!description) {
        description = getAttr(doc.querySelector("meta[name='description'], meta[property='og:description']"), "content");
      }

      // Determine type and extract episodes/qualities
      const type = url.includes("/series/") || title.toLowerCase().includes("season") ? "series" : "movie";

      let episodes = [];

      if (type === "movie") {
        // For movies, the "episodes" are actually quality options
        // Look for quality links on the loanid page
        const qualityLinks = Array.from(doc.querySelectorAll("a[href*='loanagreement.php']"));
        
        if (qualityLinks.length > 0) {
          episodes = qualityLinks.map((link, idx) => {
            const qualityText = textOf(link);
            const quality = extractQuality(qualityText);
            const href = getAttr(link, "href");
            
            return new Episode({
              name: `${quality} - ${qualityText}`,
              url: normalizeUrl(href, manifest.baseUrl),
              season: 1,
              episode: idx + 1,
              posterUrl: posterUrl
            });
          });
        } else {
          // Single movie entry
          episodes = [new Episode({
            name: title,
            url: url,
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          })];
        }
      } else {
        // Series handling - look for episode lists
        const episodeElements = doc.querySelectorAll(".episode-item, .ep-item, .episode");
        
        if (episodeElements.length > 0) {
          episodes = Array.from(episodeElements).map((ep, idx) => {
            const epTitle = textOf(ep.querySelector(".ep-title, .title")) || `Episode ${idx + 1}`;
            const epLink = ep.querySelector("a[href*='loanid.php'], a[href*='loanagreement.php']");
            const href = getAttr(epLink, "href") || url;
            
            return new Episode({
              name: epTitle,
              url: normalizeUrl(href, manifest.baseUrl),
              season: 1,
              episode: idx + 1,
              posterUrl: posterUrl
            });
          });
        } else {
          // Fallback for series without explicit episode list
          episodes = [new Episode({
            name: title,
            url: url,
            season: 1,
            episode: 1,
            posterUrl: posterUrl
          })];
        }
      }

      const item = new MultimediaItem({
        title,
        url,
        posterUrl,
        description,
        type,
        contentType: type,
        episodes: episodes
      });

      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
    }
  }

  async function loadStreams(url, cb) {
    try {
      const streams = [];
      
      // Check if this is a loanagreement.php URL (quality selection page)
      if (url.includes("loanagreement.php")) {
        const doc = await loadDoc(url);
        const html = doc?.body?.innerHTML || "";
        
        // Look for direct download links in the page source
        // Pattern: cdn.cdngo.site or similar CDN domains
        const cdnPatterns = [
          /https?:\/\/cdn\.[a-z0-9]+\.[a-z]+\/[^"'\s<>]+/gi,
          /https?:\/\/[^"'\s<>]*cdn[^"'\s<>]*\/[^"'\s<>]+\.(mkv|mp4|m3u8|avi|mov)/gi,
          /https?:\/\/[^"'\s<>]+\.(mkv|mp4|m3u8|avi|mov)/gi
        ];

        for (const pattern of cdnPatterns) {
          const matches = html.match(pattern) || [];
          for (const match of matches) {
            if (!streams.some(s => s.url === match)) {
              // Extract quality from URL or page context
              const quality = extractQuality(match) || extractQuality(url);
              
              streams.push(new StreamResult({
                url: match,
                quality: quality,
                source: `TellyBiz ${quality}`,
                headers: {
                  "User-Agent": UA,
                  "Referer": url,
                  "Origin": manifest.baseUrl
                }
              }));
            }
          }
        }

        // Look for iframe embeds
        const iframes = doc.querySelectorAll("iframe[src]");
        for (const iframe of iframes) {
          const src = getAttr(iframe, "src");
          if (src) {
            streams.push(new StreamResult({
              url: src,
              quality: "Auto",
              source: "Embed",
              headers: {
                "User-Agent": UA,
                "Referer": url
              }
            }));
          }
        }
      } else if (url.includes("loanid.php")) {
        // If we got the loanid page instead of loanagreement, we need to fetch it
        // Extract the lid parameter
        const lidMatch = url.match(/[?&]lid=([^&]+)/);
        if (lidMatch) {
          const lid = lidMatch[1];
          // Try to get the first quality option (usually 720p or 1080p)
          const qualityUrl = `${manifest.baseUrl}/loanagreement.php?lid=${lid}&f=0`;
          return await loadStreams(qualityUrl, cb);
        }
      }

      // Remove duplicates
      const seen = new Set();
      const uniqueStreams = streams.filter(s => {
        if (!s.url || seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });

      if (uniqueStreams.length === 0) {
        cb({ success: false, errorCode: "NO_STREAMS", message: "No video streams found" });
      } else {
        cb({ success: true, data: uniqueStreams });
      }
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
    }
  }

  // Export functions to global scope
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
