(function() {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
    "Referer": `${manifest.baseUrl}/`
  };

  // Helpers
  function normalizeUrl(url, base = manifest.baseUrl) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/")) return `${base}${url}`;
    return `${base}/${url}`;
  }

  function htmlDecode(text) {
    if (!text) return "";
    return String(text)
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
  }

  function textOf(el) {
    return htmlDecode((el?.textContent || "").replace(/\s+/g, " ").trim());
  }

  function getAttr(el, ...attrs) {
    if (!el) return "";
    for (const attr of attrs) {
      const v = el.getAttribute(attr);
      if (v?.trim()) return v.trim();
    }
    return "";
  }

  function extractQuality(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("2160") || t.includes("4k")) return "4K";
    if (t.includes("1080")) return "1080p";
    if (t.includes("720")) return "720p";
    if (t.includes("480")) return "480p";
    return "Auto";
  }

  function extractFileSize(text) {
    const match = String(text || "").match(/(\d+\.?\d*\s*(?:GB|MB))/i);
    return match ? match[1].trim() : "";
  }
  async function request(url, headers = {}) {
    return http_get(url, { headers: { ...BASE_HEADERS, ...headers } });
  }

  async function loadDoc(url) {
    const res = await request(url);
    return await parseHtml(res.body);
  }

  // Parse homepage movie cards
  function parseMovieCard(el) {
    const anchor = el.querySelector("a.movie-card");
    if (!anchor) return null;
    const href = normalizeUrl(getAttr(anchor, "href"));
    if (!href || !href.includes("loanid.php")) return null;

    const img = el.querySelector("img.movie-poster");
    const posterUrl = normalizeUrl(getAttr(img, "src", "data-src"));
    const title = textOf(el.querySelector(".movie-title"));
    const year = textOf(el.querySelector(".movie-year"));
    const rating = textOf(el.querySelector(".rating-badge"))?.replace("★", "").trim();

    if (!title) return null;

    return new MultimediaItem({
      title,
      url: href,
      posterUrl,
      type: "movie",
      year: year ? parseInt(year) : null,
      score: rating ? parseFloat(rating) : null
    });
  }

  // getHome: Load trending/latest movies
  async function getHome(cb) {
    try {
      const doc = await loadDoc(manifest.baseUrl);
      const items = Array.from(doc.querySelectorAll(".movies-grid .movie-card").map(el => el.parentElement))
        .map(parseMovieCard)
        .filter(Boolean);

      cb({ success: true, data: { "Latest Updates": items.slice(0, 24) } });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
    }
  }

  // search: Search movies  async function search(query, cb) {
    try {
      const encoded = encodeURIComponent(query);
      const url = `${manifest.baseUrl}/?q=${encoded}`;
      const doc = await loadDoc(url);
      
      const items = Array.from(doc.querySelectorAll(".movies-grid .movie-card").map(el => el.parentElement))
        .map(parseMovieCard)
        .filter(Boolean);

      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
    }
  }

  // load: Parse movie detail page for qualities
  async function load(url, cb) {
    try {
      const doc = await loadDoc(url);
      
      const title = textOf(doc.querySelector("h1.movie-title")) || "Unknown";
      const posterUrl = normalizeUrl(getAttr(doc.querySelector("img.poster"), "src"));
      const description = textOf(doc.querySelector("p.overview"));
      const genres = Array.from(doc.querySelectorAll(".genre-tag")).map(el => textOf(el));
      const year = textOf(doc.querySelector(".movie-meta span:first-child"))?.match(/\d{4}/)?.[0];
      const rating = textOf(doc.querySelector(".rating"))?.match(/[\d.]+/)?.[0];

      // Parse download qualities from file-item elements
      const episodes = Array.from(doc.querySelectorAll(".file-item")).map((item, idx) => {
        const dataHref = getAttr(item, "data-href");
        if (!dataHref || !dataHref.includes("loanagreement.php")) return null;
        
        const fileName = textOf(item.querySelector(".file-name"));
        const fileSize = extractFileSize(textOf(item.querySelector(".file-size")));
        const quality = extractQuality(fileName);

        return new Episode({
          name: `${quality} ${fileSize ? `- ${fileSize}` : ""}`,
          url: normalizeUrl(dataHref),
          season: 1,
          episode: idx + 1,
          posterUrl,
          description: fileName
        });
      }).filter(Boolean);

      const movie = new MultimediaItem({
        title,
        url,        posterUrl,
        description,
        type: "movie",
        year: year ? parseInt(year) : null,
        score: rating ? parseFloat(rating) : null,
        genres,
        episodes: episodes.length > 0 ? episodes : [{
          name: title,
          url,
          season: 1,
          episode: 1,
          posterUrl
        }]
      });

      cb({ success: true, data: movie });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
    }
  }

  // loadStreams: Extract final CDN download link from loanagreement.php
  async function loadStreams(url, cb) {
    try {
      const doc = await loadDoc(url);
      const streams = [];

      // Method 1: Look for direct CDN link in page source
      const cdnMatch = doc.documentElement.innerHTML.match(/https?:\/\/cdn\.[^"'\s]+\.mkv/i);
      if (cdnMatch) {
        streams.push(new StreamResult({
          url: cdnMatch[0],
          quality: extractQuality(cdnMatch[0]),
          headers: { "Referer": `${manifest.baseUrl}/`, "User-Agent": UA }
        }));
      }

      // Method 2: Look for download button with direct href
      const downloadBtn = doc.querySelector("a.download-btn[href*='.mkv'], a[href*='cdn.']");
      if (downloadBtn) {
        const directUrl = normalizeUrl(getAttr(downloadBtn, "href"));
        if (directUrl && !streams.some(s => s.url === directUrl)) {
          streams.push(new StreamResult({
            url: directUrl,
            quality: extractQuality(directUrl),
            headers: { "Referer": `${manifest.baseUrl}/`, "User-Agent": UA }
          }));
        }
      }
      // Method 3: Parse script variables containing CDN URL
      const scripts = Array.from(doc.querySelectorAll("script")).map(s => s.textContent).join("\n");
      const scriptMatches = scripts.matchAll(/https?:\/\/cdn\.[^"'\s]+\.mkv/gi);
      for (const match of scriptMatches) {
        const streamUrl = match[0];
        if (!streams.some(s => s.url === streamUrl)) {
          streams.push(new StreamResult({
            url: streamUrl,
            quality: extractQuality(streamUrl),
            headers: { "Referer": `${manifest.baseUrl}/`, "User-Agent": UA }
          }));
        }
      }

      cb({ success: true, data: streams.length > 0 ? streams : [{
        url: url.replace("loanagreement.php", "final.php"),
        quality: "Auto",
        headers: { "Referer": `${manifest.baseUrl}/` }
      }] });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
    }
  }

  // Export functions
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
