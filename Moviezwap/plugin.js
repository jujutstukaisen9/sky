(function() {
 /**
  * @type {import('@skystream/sdk').Manifest}
  */
 // var manifest is injected at runtime

 // Common headers for requests (User-Agent, Accept, etc.)
 const CommonHeaders = {
   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
   "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
   "Accept-Language": "en-US,en;q=0.9",
   "Accept-Encoding": "gzip, deflate",
   "Connection": "keep-alive",
   "Upgrade-Insecure-Requests": "1"
 };

 // Minimal DOM parser for HTML extraction (replaces Kotlin Jsoup)
 class SimpleDOM {
   constructor(html) {
     this.html = html;
   }

   querySelector(selector) {
     // a[href*='/movie/'] selector
     if (selector === "a[href*='/movie/']") {
       const regex = /<a[^>]*href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       const results = [];
       let m;
       while ((m = regex.exec(this.html)) !== null) {
         results.push({
           attr: (name) => name === 'href' ? m[1] : '',
           text: () => m[2].replace(/<[^>]+>/g, '').trim()
         });
       }
       return {
         map: (fn) => results.map(fn).filter(Boolean),
         filter: (fn) => results.filter(fn)
       };
     }
     // img[src*='/poster/'] selector
     if (selector.startsWith("img[src*=")) {
       const attrMatch = selector.match(/\[src\*=['"]([^'"]+)['"]\]/);
       if (attrMatch) {
         const srcVal = attrMatch[1];
         const regex = new RegExp(`<img[^>]*src="([^"]*${srcVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"[^>]*>`, 'i');
         const match = this.html.match(regex);
         if (match) return { attr: (name) => name === 'src' ? match[1] : '' };
       }
     }
     // td:contains() + td selector     if (selector.includes(":contains(") && selector.includes("+ td")) {
       const containsMatch = selector.match(/td:contains\(([^)]+)\)\s*\+\s*td/);
       if (containsMatch) {
         const searchText = containsMatch[1].replace(/['"]/g, '');
         const regex = new RegExp(`<td[^>]*>[\\s\\S]*?${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i');
         const match = this.html.match(regex);
         if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
       }
     }
     // h2, title selectors
     if (selector === "h2") {
       const match = this.html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
       if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
     }
     if (selector === "title") {
       const match = this.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
       if (match) return { text: () => match[1].replace(/<[^>]+>/g, '').trim() };
     }
     // download.php/dwload.php selector
     if (selector.includes("download.php") || selector.includes("dwload.php")) {
       const regex = /<a[^>]*href="([^"]*(?:download|dwload)\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       const results = [];
       let m;
       while ((m = regex.exec(this.html)) !== null) {
         results.push({
           attr: (name) => name === 'href' ? m[1] : '',
           text: () => m[2].replace(/<[^>]+>/g, '').trim()
         });
       }
       return { map: (fn) => results.map(fn).filter(Boolean) };
     }
     // a:contains() selector
     if (selector.includes(":contains(")) {
       const containsMatch = selector.match(/a:contains\(([^)]+)\)/);
       if (containsMatch) {
         const searchText = containsMatch[1].replace(/['"]/g, '');
         const regex = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>([\\s\\S]*?${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?)</a>`, 'i');
         const match = this.html.match(regex);
         if (match) {
           return {
             attr: (name) => name === 'href' ? match[1] : '',
             text: () => match[2].replace(/<[^>]+>/g, '').trim()
           };
         }
       }
     }
     return null;
   }

   querySelectorAll(selector) {     const result = this.querySelector(selector);
     return result && result.map ? result : (result ? [result] : []);
   }
 }

 // Helper: Fix relative URLs using dynamic baseUrl
 function fixUrl(url, base = manifest.baseUrl) {
   if (!url) return "";
   if (url.startsWith("//")) return "https:" + url;
   if (url.startsWith("/")) return base.replace(/\/$/, '') + url;
   return url;
 }

 // Helper: Extract quality from link text
 function getQuality(text) {
   if (!text) return "Auto";
   const t = text.toLowerCase();
   if (t.includes("2160p") || t.includes("4k")) return "2160p";
   if (t.includes("1080p")) return "1080p";
   if (t.includes("720p")) return "720p";
   if (t.includes("480p")) return "480p";
   if (t.includes("360p")) return "360p";
   if (t.includes("320p")) return "320p";
   return "Auto";
 }

 // Helper: Check if title indicates a series
 function isSeriesTitle(title) {
   return /(season|episodes?|eps|all episodes|web series)/i.test(title);
 }

 // Helper: Extract year from text
 function extractYear(text) {
   const match = /\b(\d{4})\b/.exec(text || "");
   return match ? parseInt(match[1]) : null;
 }

 // Helper: Decode HTML entities
 function decodeHtml(str) {
   if (!str) return "";
   return str.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
             .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
 }

 // ==================== CORE FUNCTIONS ====================

 /**
  * getHome: Returns categories for the dashboard
  * SkyStream Rule: "Trending" category goes to Hero Carousel  */
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
       const pageUrl = `${manifest.baseUrl}${cat.url}`;
       const res = await http_get(pageUrl, CommonHeaders);

       if (res && res.body) {
         const doc = new SimpleDOM(res.body);
         const items = [];

         const links = doc.querySelectorAll("a[href*='/movie/']");
         if (links && links.map) {
           links.map(link => {
             const href = fixUrl(link.attr("href"));
             const title = decodeHtml(link.text().trim() || href.split("/").pop().replace(".html", "").replace(/-/g, " "));

             if (title && href && !href.includes("javascript")) {
               const type = isSeriesTitle(title) ? "tvseries" : "movie";
               items.push(new MultimediaItem({
                 title: title,
                 url: href,
                 posterUrl: "",
                 type: type
               }));
             }
           });
         }

         if (items.length > 0) {
           results[cat.name] = items;
         }
       }
     }

     cb({ success: true,  results });
   } catch (e) {
     cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
   } }

 /**
  * search: Handles user queries
  */
 async function search(query, cb) {
   try {
     const fixedQuery = query.replace(/\s+/g, "+");
     const searchUrl = `${manifest.baseUrl}/search.php?q=${fixedQuery}`;

     const res = await http_get(searchUrl, CommonHeaders);
     if (!res || !res.body) return cb({ success: true, data: [] });

     const doc = new SimpleDOM(res.body);
     const items = [];

     const links = doc.querySelectorAll("a[href*='/movie/']");
     if (links && links.map) {
       links.map(link => {
         const href = fixUrl(link.attr("href"));
         const title = decodeHtml(link.text().trim() || href.split("/").pop().replace(".html", "").replace(/-/g, " "));

         if (title && href && !href.includes("javascript")) {
           const type = isSeriesTitle(title) ? "tvseries" : "movie";
           items.push(new MultimediaItem({
             title: title,
             url: href,
             posterUrl: "",
             type: type
           }));
         }
       });
     }

     const unique = items.filter((item, index, self) =>
       index === self.findIndex(t => t.url === item.url)
     );

     cb({ success: true, data: unique });
   } catch (e) {
     cb({ success: true, data: [] });
   }
 }

 /**
  * load: Fetches full details for a specific item
  */
 async function load(url, cb) {
   try {
     const res = await http_get(url, CommonHeaders);     if (!res || !res.body) {
       return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load page" });
     }

     const doc = new SimpleDOM(res.body);

     // Extract title
     let title = doc.querySelector("h2")?.text() || doc.querySelector("title")?.text()?.split("-")[0]?.trim();
     if (!title) return cb({ success: false, errorCode: "PARSE_ERROR", message: "Could not extract title" });
     title = decodeHtml(title);

     // Extract poster
     const posterEl = doc.querySelector("img[src*='/poster/']");
     const poster = posterEl ? fixUrl(posterEl.attr("src")) : "";

     // Extract description
     const descEl = doc.querySelector("td:contains('Desc/Plot') + td");
     let description = descEl?.text() || "";
     if (!description) {
       const pMatch = res.body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
       description = pMatch ? decodeHtml(pMatch[1].trim()) : "";
     }

     // Extract year
     const yearText = doc.querySelector("td:contains('Release Date') + td")?.text() ||
                      doc.querySelector("td:contains('Category') + td")?.text() || "";
     const year = extractYear(yearText);

     // Handle series vs movie
     const isSeries = isSeriesTitle(title);
     const seasonLinks = doc.querySelectorAll("div.catList a[href*='/movie/']");
     let episodes = [];

     if (isSeries && seasonLinks && seasonLinks.map) {
       seasonLinks.map(el => {
         const epTitle = decodeHtml(el.text().trim());
         const epUrl = fixUrl(el.attr("href"));
         const seasonMatch = /seasons*?(\d+)/i.exec(epTitle);
         const epMatch = /eps?\s*(\d+)(?:\s*to\s*(\d+))?/i.exec(epTitle);
         const season = seasonMatch ? parseInt(seasonMatch[1]) : 1;
         const epStart = epMatch ? parseInt(epMatch[1]) : 1;

         episodes.push(new Episode({
           name: epTitle,
           url: epUrl,
           season: season,
           episode: epStart
         }));
       });
     } else {       episodes.push(new Episode({
         name: "Full Movie",
         url: url,
         season: 1,
         episode: 1
       }));
     }

     const itemType = isSeries && episodes.length > 1 ? "tvseries" : "movie";

     cb({
       success: true,
        new MultimediaItem({
         title: title,
         url: url,
         posterUrl: poster,
         type: itemType,
         year: year,
         description: description,
         episodes: episodes
       })
     });
   } catch (e) {
     cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
   }
 }

 /**
  * loadStreams: Provides playable video links
  */
 async function loadStreams(url, cb) {
   try {
     const res = await http_get(url, CommonHeaders);
     if (!res || !res.body) {
       return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Failed to load streams" });
     }

     const doc = new SimpleDOM(res.body);
     const results = [];

     // Find download links: a[href*='dwload.php'] or a[href*='download.php']
     const downloadLinks = doc.querySelectorAll("a[href*='dwload.php']");

     if (downloadLinks && downloadLinks.map) {
       downloadLinks.map(linkEl => {
         let downloadPageUrl = fixUrl(linkEl.attr("href"));
         downloadPageUrl = downloadPageUrl.replace("dwload.php", "download.php");
         const linkText = decodeHtml(linkEl.text().trim());
         const quality = getQuality(linkText);
         results.push(new StreamResult({
           url: downloadPageUrl,
           source: `Moviezwap - ${linkText}`,
           quality: quality,
           headers: {
             ...CommonHeaders,
             "Referer": manifest.baseUrl
           }
         }));
       });
     }

     // Regex fallback if selectors fail
     if (results.length === 0) {
       const linkRegex = /<a[^>]*href="([^"]*(?:download|dwload)\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
       let m;
       while ((m = linkRegex.exec(res.body)) !== null) {
         let downloadUrl = fixUrl(m[1].replace("dwload.php", "download.php"));
         const linkText = decodeHtml(m[2].replace(/<[^>]+>/g, "").trim());
         const quality = getQuality(linkText);

         results.push(new StreamResult({
           url: downloadUrl,
           source: `Moviezwap - ${linkText}`,
           quality: quality,
           headers: {
             ...CommonHeaders,
             "Referer": manifest.baseUrl
           }
         }));
       }
     }

     const unique = results.filter((item, index, self) =>
       index === self.findIndex(t => t.url === item.url)
     );

     cb({ success: true,  unique });
   } catch (e) {
     cb({ success: false, errorCode: "PARSE_ERROR", message: "Failed to extract streams: " + e.message });
   }
 }

 // Export to SkyStream runtime
 globalThis.getHome = getHome;
 globalThis.search = search;
 globalThis.load = load;
 globalThis.loadStreams = loadStreams;
})();
