(function() {
 /**
  * @type {import('@skystream/sdk').Manifest}
  */
 // manifest is injected at runtime

 // Configurable headers with fallback User-Agents
 const HEADERS = {
   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
   "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
   "Accept-Language": "en-US,en;q=0.9",
   "Accept-Encoding": "gzip, deflate",
   "Connection": "keep-alive",
   "Upgrade-Insecure-Requests": "1",
   "Sec-Fetch-Dest": "document",
   "Sec-Fetch-Mode": "navigate",
   "Sec-Fetch-Site": "none"
 };

 // Cookie store for session persistence
 let _cookieStore = "";

 // Simple DOM parser (fallback for Jsoup)
 class SimpleDOM {
   constructor(html) { this.html = html || ""; }
   
   querySelector(selector) {
     // Handle a[href*='/movie/'] pattern
     if (selector.includes("a[href*='/movie/']")) {
       const regex = /<a[^>]*href="([^"]*\/movie\/[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       const results = [];
       let m;
       while ((m = regex.exec(this.html)) !== null) {
         results.push({
           attr: (name) => name === 'href' ? m[1].trim() : '',
           text: () => m[2].replace(/<[^>]+>/g, '').trim()
         });
       }
       return { map: (fn) => results.map(fn).filter(Boolean) };
     }
     // Handle img[src*='/poster/']
     if (selector.includes("img[src*=")) {
       const srcMatch = selector.match(/\[src\*=['"]([^'"]+)['"]\]/);
       if (srcMatch) {
         const regex = new RegExp(`<img[^>]*src="([^"]*${srcMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"[^>]*>`, 'i');
         const match = this.html.match(regex);
         if (match) return { attr: (name) => name === 'src' ? match[1].trim() : '' };
       }
     }
     // Handle td:contains() + td pattern     if (selector.includes(":contains(") && selector.includes("+ td")) {
       const containsMatch = selector.match(/:contains\(([^)]+)\)\s*\+\s*td/);
       if (containsMatch) {
         const searchText = containsMatch[1].replace(/['"]/g, '');
         const regex = new RegExp(`<td[^>]*>[\\s\\S]*?${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i');
         const match = this.html.match(regex);
         if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
       }
     }
     // Handle h2, title
     if (selector === "h2") {
       const match = this.html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
       if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
     }
     if (selector === "title") {
       const match = this.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
       if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
     }
     // Handle download.php / dwload.php links
     if (selector.includes("download.php") || selector.includes("dwload.php")) {
       const regex = /<a[^>]*href="([^"]*(?:download|dwload)\.php[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       const results = [];
       let m;
       while ((m = regex.exec(this.html)) !== null) {
         results.push({
           attr: (name) => name === 'href' ? m[1].trim() : '',
           text: () => m[2].replace(/<[^>]+>/g, '').trim()
         });
       }
       return { map: (fn) => results.map(fn).filter(Boolean) };
     }
     return null;
   }
 }

 // Helpers
 function fixUrl(url, base = manifest.baseUrl) {
   if (!url) return "";
   if (url.startsWith("//")) return "https:" + url;
   if (url.startsWith("/")) return base.replace(/\/$/, '') + url;
   return url;
 }

 function getQuality(text) {
   if (!text) return "Auto";
   const t = text.toLowerCase();
   if (t.includes("2160p") || t.includes("4k")) return "2160p";
   if (t.includes("1080p")) return "1080p";
   if (t.includes("720p")) return "720p";
   if (t.includes("480p")) return "480p";   if (t.includes("360p")) return "360p";
   if (t.includes("320p")) return "320p";
   return "Auto";
 }

 function isSeriesTitle(title) {
   return /(season|episodes?|eps|all episodes|web series)/i.test(title || "");
 }

 function extractYear(text) {
   const match = /\b(19|20)\d{2}\b/.exec(text || "");
   return match ? parseInt(match[0]) : null;
 }

 function decodeHtml(str) {
   if (!str) return "";
   return str.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
             .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
 }

 // Enhanced HTTP wrapper with retry & cookie support
 async function safeFetch(url, headers = {}, retries = 2) {
   try {
     const reqHeaders = { ...HEADERS, ...headers };
     if (_cookieStore) reqHeaders["Cookie"] = _cookieStore;
     
     const res = await http_get(url, reqHeaders);
     
     // Store cookies from response if present
     if (res?.headers?.["set-cookie"]) {
       _cookieStore = res.headers["set-cookie"].split(";")[0];
     }
     
     if (!res || !res.body || res.statusCode >= 400) {
       throw new Error(`HTTP ${res?.statusCode || "unknown"}`);
     }
     return res;
   } catch (e) {
     if (retries > 0) {
       // Simple exponential backoff
       await new Promise(r => setTimeout(r, 500 * (3 - retries)));
       return safeFetch(url, headers, retries - 1);
     }
     throw e;
   }
 }

 // ==================== CORE FUNCTIONS ====================
 async function getHome(cb) {
   try {
     const categories = [
       { name: "Trending", url: "/category/Telugu-(2025)-Movies.html" },
       { name: "Telugu (2026) Movies", url: "/category/Telugu-(2026)-Movies.html" },
       { name: "Tamil (2026) Movies", url: "/category/Tamil-(2026)-Movies.html" },
       { name: "Tamil (2025) Movies", url: "/category/Tamil-(2025)-Movies.html" },
       { name: "Telugu Dubbed Hollywood", url: "/category/Telugu-Dubbed-Movies-[Hollywood].html" },
       { name: "HOT Web Series", url: "/category/HOT-Web-Series.html" }
     ];

     const results = {};

     for (const cat of categories) {
       try {
         const pageUrl = `${manifest.baseUrl}${cat.url}`;
         const res = await safeFetch(pageUrl);
         const doc = new SimpleDOM(res.body);
         const items = [];

         const links = doc.querySelectorAll("a[href*='/movie/']");
         if (links?.map) {
           links.map(link => {
             const href = fixUrl(link.attr("href"));
             const title = decodeHtml(link.text() || href.split("/").pop().replace(".html", "").replace(/-/g, " "));
             if (title && href && !href.includes("javascript")) {
               items.push(new MultimediaItem({
                 title: title.trim(),
                 url: href,
                 posterUrl: "",
                 type: isSeriesTitle(title) ? "tvseries" : "movie"
               }));
             }
           });
         }

         if (items.length > 0) results[cat.name] = items;
       } catch (e) {
         // Skip category if unreachable, continue with others
         console.warn(`Category ${cat.name} failed: ${e.message}`);
       }
     }

     cb({ success: Object.keys(results).length > 0,  results });
   } catch (e) {
     cb({ success: false, errorCode: "SITE_OFFLINE", message: `Base URL unreachable: ${e.message}` });
   }
 }

 async function search(query, cb) {   try {
     const fixedQuery = encodeURIComponent(query.replace(/\s+/g, " "));
     const searchUrl = `${manifest.baseUrl}/search.php?q=${fixedQuery}`;
     const res = await safeFetch(searchUrl);
     if (!res?.body) return cb({ success: true,  [] });

     const doc = new SimpleDOM(res.body);
     const items = [];

     const links = doc.querySelectorAll("a[href*='/movie/']");
     if (links?.map) {
       links.map(link => {
         const href = fixUrl(link.attr("href"));
         const title = decodeHtml(link.text() || href.split("/").pop().replace(".html", "").replace(/-/g, " "));
         if (title && href && !href.includes("javascript")) {
           items.push(new MultimediaItem({
             title: title.trim(),
             url: href,
             posterUrl: "",
             type: isSeriesTitle(title) ? "tvseries" : "movie"
           }));
         }
       });
     }

     const unique = items.filter((item, idx, self) => 
       idx === self.findIndex(t => t.url === item.url)
     );
     cb({ success: true, data: unique });
   } catch (e) {
     cb({ success: true, data: [] }); // Return empty instead of error for search
   }
 }

 async function load(url, cb) {
   try {
     const res = await safeFetch(url);
     if (!res?.body) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Page not reachable" });

     const doc = new SimpleDOM(res.body);
     
     // Extract title with fallbacks
     let title = doc.querySelector("h2")?.text() || 
                 doc.querySelector("title")?.text()?.split("-")[0]?.trim();
     if (!title) return cb({ success: false, errorCode: "PARSE_ERROR", message: "Could not extract title" });
     title = decodeHtml(title);

     // Poster
     const posterEl = doc.querySelector("img[src*='/poster/']");
     const poster = posterEl ? fixUrl(posterEl.attr("src")) : "";
     // Description
     const descEl = doc.querySelector("td:contains('Desc/Plot') + td");
     let description = descEl?.text() || "";
     if (!description) {
       const pMatch = res.body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
       description = pMatch ? decodeHtml(pMatch[1].trim()) : "";
     }

     // Year
     const yearText = doc.querySelector("td:contains('Release Date') + td")?.text() ||
                      doc.querySelector("td:contains('Category') + td")?.text() || "";
     const year = extractYear(yearText);

     // Series detection & episodes
     const isSeries = isSeriesTitle(title);
     const seasonLinks = doc.querySelectorAll("div.catList a[href*='/movie/']");
     let episodes = [];

     if (isSeries && seasonLinks?.map) {
       seasonLinks.map(el => {
         const epTitle = decodeHtml(el.text().trim());
         const epUrl = fixUrl(el.attr("href"));
         const seasonMatch = /seasons*(\d+)/i.exec(epTitle);
         const epMatch = /eps?(\d+)(?:\s*to\s*(\d+))?/i.exec(epTitle);
         episodes.push(new Episode({
           name: epTitle,
           url: epUrl,
           season: seasonMatch ? parseInt(seasonMatch[1]) : 1,
           episode: epMatch ? parseInt(epMatch[1]) : 1
         }));
       });
     } else {
       episodes.push(new Episode({ name: "Full Movie", url: url, season: 1, episode: 1 }));
     }

     cb({
       success: true,
        new MultimediaItem({
         title: title,
         url: url,
         posterUrl: poster,
         type: (isSeries && episodes.length > 1) ? "tvseries" : "movie",
         year: year,
         description: description,
         episodes: episodes
       })
     });
   } catch (e) {
     cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });   }
 }

 async function loadStreams(url, cb) {
   try {
     const res = await safeFetch(url);
     if (!res?.body) return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Cannot load streams" });

     const doc = new SimpleDOM(res.body);
     const results = [];

     // Primary: Find download links
     const downloadLinks = doc.querySelectorAll("a[href*='dwload.php']");
     if (downloadLinks?.map) {
       downloadLinks.map(linkEl => {
         let downloadPageUrl = fixUrl(linkEl.attr("href").replace("dwload.php", "download.php"));
         const linkText = decodeHtml(linkEl.text().trim());
         const quality = getQuality(linkText);

         results.push(new StreamResult({
           url: downloadPageUrl,
           source: `Moviezwap - ${linkText}`,
           quality: quality,
           headers: { ...HEADERS, "Referer": manifest.baseUrl }
         }));
       });
     }

     // Fallback: Regex extraction if selectors fail
     if (results.length === 0) {
       const linkRegex = /<a[^>]*href="([^"]*(?:download|dwload)\.php[^"#]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       let m;
       while ((m = linkRegex.exec(res.body)) !== null) {
         let downloadUrl = fixUrl(m[1].replace("dwload.php", "download.php"));
         const linkText = decodeHtml(m[2].replace(/<[^>]+>/g, "").trim());
         results.push(new StreamResult({
           url: downloadUrl,
           source: `Moviezwap - ${linkText}`,
           quality: getQuality(linkText),
           headers: { ...HEADERS, "Referer": manifest.baseUrl }
         }));
       }
     }

     // Deduplicate
     const unique = results.filter((item, idx, self) => 
       idx === self.findIndex(t => t.url === item.url)
     );

     cb({ success: unique.length > 0,  unique });   } catch (e) {
     cb({ success: false, errorCode: "PARSE_ERROR", message: `Stream extraction failed: ${e.message}` });
   }
 }

 // Export
 globalThis.getHome = getHome;
 globalThis.search = search;
 globalThis.load = load;
 globalThis.loadStreams = loadStreams;
})();
