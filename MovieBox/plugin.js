(function() {
  /**
   * @type {import('@skystream/sdk').Manifest}
   */
  // manifest is injected at runtime by SkyStream

  // === Constants ===
  const CINEMETA_URL = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

  // === Helpers ===

  function cleanTitle(raw) {
    if (!raw) return "Unknown";
    return raw
      .replace(/Download\s+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
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
    if (!el) return "";
    return htmlDecode((el.textContent || "").replace(/\s+/g, " ").trim());
  }

  function resolveUrl(href, base) {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return base.replace(/\/$/, "") + href;
    return base.replace(/\/$/, "") + "/" + href;
  }

  function extractAttr(html, selector, attr) {
    const match = html.match(new RegExp(`<${selector}[^>]*${attr}=["']?([^"'>\s]+)["']?`, "i"));
    return match ? match[1] : null;
  }

  function extractText(html, selector) {
    const match = html.match(new RegExp(`<${selector}[^>]*>([^<]*)</${selector.split(" ")[0]}>`, "i"));    return match ? htmlDecode(match[1]).trim() : null;
  }

  async function bypass(id) {
    try {
      const url = `https://web.sidexfee.com/?id=${id}`;
      const res = await http_get(url);
      const doc = res.body || "";
      const encodeUrl = doc.match(/"link":"([^"]+)"/)?.[1] || "";
      if (!encodeUrl) return null;
      const decoded = encodeUrl.replace(/\\\//g, "/");
      return atob(decoded);
    } catch (e) {
      return null;
    }
  }

  function parseArticle(articleHtml, baseUrl) {
    const titleMatch = articleHtml.match(/<a[^>]*title=["']?([^"'>\s]+)["']?[^>]*>/i);
    const rawTitle = titleMatch ? titleMatch[1] : null;
    if (!rawTitle) return null;
    
    const title = cleanTitle(rawTitle);
    const href = articleHtml.match(/<a[^>]*href=["']?([^"'>\s]+)["']/i)?.[1];
    if (!href) return null;
    
    const posterUrl = articleHtml.match(/<img[^>]*src=["']?([^"'>\s]+)["']/i)?.[1] || null;
    const url = resolveUrl(href, baseUrl);
    
    return new MultimediaItem({
      title,
      url,
      posterUrl,
      type: "movie"
    });
  }

  // === Core Functions ===

  async function getHome(cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const sections = [
        { name: "Trending", path: "" },
        { name: "Bollywood Movies", path: "/movies/bollywood/" },
        { name: "Hollywood Movies", path: "/movies/hollywood/" },
        { name: "Anime", path: "/anime/" }
      ];

      const homeData = {};
      for (const section of sections) {
        try {
          const pageUrl = section.path ? `${baseUrl}${section.path}` : baseUrl;
          const res = await http_get(pageUrl, {
            headers: { "User-Agent": UA, "Referer": baseUrl + "/" }
          });
          const html = res.body || "";
          
          const items = [];
          const articleRegex = /<article[^>]*class="[^"]*post-card[^"]*"[^>]*>[\s\S]*?<\/article>/gi;
          let articleMatch;
          
          while ((articleMatch = articleRegex.exec(html)) !== null) {
            const item = parseArticle(articleMatch[0], baseUrl);
            if (item) items.push(item);
          }
          
          if (items.length > 0) {
            homeData[section.name] = items;
          }
        } catch (e) {
          console.error(`Section [${section.name}] failed: ${e.message}`);
        }
      }

      cb({ success: true, data: homeData });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
    }
  }

  async function search(query, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const searchUrl = `${baseUrl}/search/${encodeURIComponent(query)}/page/1/`;
      
      const res = await http_get(searchUrl, {
        headers: { "User-Agent": UA, "Referer": baseUrl + "/" }
      });
      const html = res.body || "";
      
      const results = [];
      const articleRegex = /<article[^>]*class="[^"]*post-card[^"]*"[^>]*>[\s\S]*?<\/article>/gi;
      let articleMatch;
      
      while ((articleMatch = articleRegex.exec(html)) !== null) {
        const item = parseArticle(articleMatch[0], baseUrl);
        if (item) results.push(item);
      }      
      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
    }
  }

  async function load(url, cb) {
    try {
      const baseUrl = manifest.baseUrl;
      const res = await http_get(url, {
        headers: { "User-Agent": UA, "Referer": baseUrl + "/" }
      });
      const html = res.body || "";

      // Extract basic metadata
      let title = extractText(html, 'title')?.replace(/Download\s+/gi, "") || "Unknown";
      const posterUrl = extractAttr(html, 'meta\\s+property=["\']og:image["\']', 'content');
      const description = html.match(/<span[^>]*id=["']?summary["']?[^>]*>([^<]*)</span>/i)?.[1] || "";
      
      // Determine type
      const isSeries = title.toLowerCase().includes("series") || url.includes("web-series");
      
      // Try to get IMDb URL for metadata enrichment
      const imdbMatch = html.match(/<div[^>]*class=["']?imdb_left["']?[^>]*>\s*<a[^>]*href=["']?([^"'>\s]+)["']/i);
      const imdbUrl = imdbMatch ? imdbMatch[1] : null;
      
      let enrichedData = null;
      if (imdbUrl) {
        try {
          const imdbId = imdbUrl.split("title/")[1]?.split("/")[0];
          if (imdbId) {
            const metaRes = await http_get(`${CINEMETA_URL}/${isSeries ? "series" : "movie"}/${imdbId}.json`);
            if (metaRes.body?.trim().startsWith("{")) {
              enrichedData = JSON.parse(metaRes.body);
            }
          }
        } catch (_) {}
      }

      // Update metadata from enrichment if available
      if (enrichedData?.meta) {
        title = enrichedData.meta.name || title;
      }

      if (isSeries) {
        // === Series Logic ===
        const episodes = [];
        const episodeMap = new Map(); // key: "season_episode", value: { urls: [], season, episode }
        // Find season buttons: a.maxbutton-download-links, a.dl, a.btnn
        const buttonRegex = /<a[^>]*class=["']?(?:maxbutton-download-links|dl|btnn)[^>]*href=["']?([^"'>\s]+)["'][^>]*>/gi;
        let btnMatch;
        
        while ((btnMatch = buttonRegex.exec(html)) !== null) {
          let link = btnMatch[1];
          
          // Handle bypass for id= links
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            const decoded = await bypass(id);
            if (decoded) link = decoded;
          }
          
          if (!link) continue;
          
          try {
            // Get season number from preceding element
            const seasonText = html.substring(0, btnMatch.index).match(/<[^>]*>\s*Season\s*\|?S(\d+)/i);
            const season = seasonText ? parseInt(seasonText[1]) : 1;
            
            // Fetch the season page to get episodes
            const seasonRes = await http_get(link, {
              headers: { "User-Agent": UA, "Referer": url }
            });
            const seasonHtml = seasonRes.body || "";
            
            // Extract episode links: h3 > a (excluding Zip links)
            const epRegex = /<h3[^>]*>\s*<a[^>]*href=["']?([^"'>\s]+)["'][^>]*>([^<]*)<\/a>\s*<\/h3>/gi;
            let epMatch;
            let epNum = 1;
            
            while ((epMatch = epRegex.exec(seasonHtml)) !== null) {
              const epText = htmlDecode(epMatch[2]).trim();
              if (epText.toLowerCase().includes("zip")) {
                epNum++;
                continue;
              }
              
              const epUrl = epMatch[1];
              const key = `${season}_${epNum}`;
              
              if (!episodeMap.has(key)) {
                episodeMap.set(key, { urls: [], season, episode: epNum });
              }
              episodeMap.get(key).urls.push(epUrl);
              epNum++;
            }
          } catch (e) {
            console.error(`Failed to fetch season page: ${e.message}`);          }
        }

        // Build Episode objects
        for (const [key, data] of episodeMap) {
          const metaEp = enrichedData?.meta?.videos?.find(
            v => v.season === data.season && v.episode === data.episode
          );
          
          episodes.push(new Episode({
            name: metaEp?.name || `Episode ${data.episode}`,
            url: JSON.stringify(data.urls), // Pass URLs as JSON string for loadStreams
            season: data.season,
            episode: data.episode,
            description: metaEp?.overview || null,
            posterUrl: metaEp?.thumbnail || null,
            aired: metaEp?.released || null
          }));
        }

        // Sort episodes
        episodes.sort((a, b) => 
          a.season !== b.season ? a.season - b.season : a.episode - b.episode
        );

        cb({
          success: true,
          data: new MultimediaItem({
            title,
            url,
            posterUrl: enrichedData?.meta?.poster || posterUrl,
            bannerUrl: enrichedData?.meta?.background || posterUrl,
            type: "series",
            description: enrichedData?.meta?.description || description,
            year: enrichedData?.meta?.year ? parseInt(enrichedData.meta.year) : undefined,
            score: enrichedData?.meta?.imdbRating ? parseFloat(enrichedData.meta.imdbRating) : undefined,
            cast: enrichedData?.meta?.cast?.map(c => new Actor({ name: c, role: "" })) || [],
            episodes
          })
        });

      } else {
        // === Movie Logic ===
        const hrefs = [];
        
        // Find download buttons: a.dl
        const dlRegex = /<a[^>]*class=["']?dl["']?[^>]*href=["']?([^"'>\s]+)["'][^>]*>/gi;
        let dlMatch;
        
        while ((dlMatch = dlRegex.exec(html)) !== null) {          let link = dlMatch[1];
          
          // Handle bypass for id= links
          if (link.includes("id=")) {
            const id = link.split("id=").pop();
            const decoded = await bypass(id);
            if (decoded) link = decoded;
          }
          
          if (link) hrefs.push(link);
        }

        cb({
          success: true,
          data: new MultimediaItem({
            title,
            url,
            posterUrl: enrichedData?.meta?.poster || posterUrl,
            bannerUrl: enrichedData?.meta?.background || posterUrl,
            type: "movie",
            description: enrichedData?.meta?.description || description,
            year: enrichedData?.meta?.year ? parseInt(enrichedData.meta.year) : undefined,
            score: enrichedData?.meta?.imdbRating ? parseFloat(enrichedData.meta.imdbRating) : undefined,
            cast: enrichedData?.meta?.cast?.map(c => new Actor({ name: c, role: "" })) || [],
            episodes: [
              new Episode({
                name: "Movie",
                url: JSON.stringify(hrefs),
                season: 1,
                episode: 1
              })
            ]
          })
        });
      }
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
    }
  }

  function getQuality(str) {
    if (!str) return 0;
    const s = str.toLowerCase();
    if (/4k|2160/.test(s)) return 2160;
    if (/1080/.test(s)) return 1080;
    if (/720/.test(s)) return 720;
    if (/480/.test(s)) return 480;
    return 0;
  }
  async function loadStreams(url, cb) {
    try {
      // url is JSON string of download page URLs from load()
      const pageUrls = JSON.parse(url);
      if (!Array.isArray(pageUrls)) {
        cb({ success: true, data: [] });
        return;
      }

      const results = [];
      const seen = new Set();

      for (const pageUrl of pageUrls) {
        try {
          const res = await http_get(pageUrl, {
            headers: { "User-Agent": UA, "Referer": manifest.baseUrl + "/" }
          });
          const html = res.body || "";

          // Extract file info
          const nameMatch = html.match(/Name\s*:\s*([^<\n]+)/i);
          const sizeMatch = html.match(/Size\s*:\s*([^<\n]+)/i);
          const fileName = nameMatch ? nameMatch[1].trim() : "";
          const fileSize = sizeMatch ? sizeMatch[1].trim() : "";
          const quality = getQuality(fileName);

          // Find download links: div.text-center a
          const linkRegex = /<div[^>]*class=["']?text-center["']?[^>]*>[\s\S]*?<a[^>]*href=["']?([^"'>\s]+)["'][^>]*>([^<]*)<\/a>/gi;
          let linkMatch;

          while ((linkMatch = linkRegex.exec(html)) !== null) {
            const linkText = htmlDecode(linkMatch[2]).trim();
            let streamUrl = linkMatch[1];

            // Skip unwanted links
            if (!streamUrl || streamUrl.includes("about:blank")) continue;

            // Handle different server types
            if (linkText.includes("FSL V2") || linkText.includes("DIRECT") || linkText.includes("CLOUD")) {
              // Direct or proxy link
            } else if (linkText.includes("FAST CLOUD")) {
              // Fetch FAST CLOUD page for actual link
              try {
                const fcRes = await http_get(streamUrl, {
                  headers: { "User-Agent": UA, "Referer": pageUrl }
                });
                const fcHtml = fcRes.body || "";
                const fcLink = fcHtml.match(/<div[^>]*class=["']?card-body["']?[^>]*>\s*<a[^>]*href=["']?([^"'>\s]+)["']/i)?.[1];
                if (fcLink) streamUrl = fcLink;
              } catch (_) { continue; }            } else if (streamUrl.includes("pixeldra")) {
              // Pixeldrain direct link format
              if (!streamUrl.includes("download")) {
                const base = streamUrl.split("/").slice(0, -1).join("/");
                const fileId = streamUrl.split("/").pop();
                streamUrl = `${base}/api/file/${fileId}?download`;
              }
            } else if (linkText.includes("Instant DL")) {
              // Follow redirect
              try {
                const instRes = await http_get(streamUrl, { allowRedirects: false });
                const location = instRes.headers?.["location"] || "";
                if (location) streamUrl = location.split("url=").pop() || location;
              } catch (_) { continue; }
            } else {
              continue; // Skip unrecognized servers
            }

            if (seen.has(streamUrl)) continue;
            seen.add(streamUrl);

            const label = quality && fileSize 
              ? `${quality}p [${fileSize}]` 
              : quality 
                ? `${quality}p` 
                : "Auto";

            results.push(new StreamResult({
              url: streamUrl,
              quality: quality > 0 ? `${quality}p` : "Auto",
              source: label,
              headers: { 
                "Referer": pageUrl,
                "User-Agent": UA 
              }
            }));
          }
        } catch (e) {
          console.error(`Failed to process page ${pageUrl}: ${e.message}`);
        }
      }

      // Sort by quality descending
      results.sort((a, b) => {
        const qa = parseInt(a.quality) || 0;
        const qb = parseInt(b.quality) || 0;
        return qb - qa;
      });

      cb({ success: true, data: results });    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
    }
  }

  // === Export ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
