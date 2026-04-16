(function() {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const MAIN_URL = manifest.baseUrl;

    async function _fetch(url) {
        const res = await http_get(url, { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
            "Referer": MAIN_URL
        });
        return res.body || "";
    }

    function _fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        if (url.startsWith("//")) return "https:" + url;
        return MAIN_URL + (url.startsWith("/") ? "" : "/") + url;
    }

    function _parseSearchResults(html) {
        const results = [];
        const regex = /<a[^>]+href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        const seenUrls = new Set();

        while ((match = regex.exec(html)) !== null) {
            const href = match[1];
            const fullUrl = _fixUrl(href);
            if (seenUrls.has(fullUrl)) continue;
            seenUrls.add(fullUrl);

            let title = match[2].replace(/<[^>]*>/g, "").trim();
            if (!title) {
                title = href.split("/").pop().replace(".html", "").replace(/-/g, " ");
            }

            if (!title || title.toLowerCase() === "home") continue;

            const isSeries = /(season|episodes?|eps|all episodes|web series)/i.test(title);

            results.push(new MultimediaItem({
                title: title,
                url: fullUrl,
                posterUrl: "", 
                type: isSeries ? "series" : "movie"
            }));
        }
        return results;
    }

    async function getHome(cb) {
        try {
            const categories = [
                { name: "Telugu (2026) Movies", url: "/category/Telugu-(2026)-Movies.html" },
                { name: "Telugu (2025) Movies", url: "/category/Telugu-(2025)-Movies.html" },
                { name: "Tamil (2026) Movies", url: "/category/Tamil-(2026)-Movies.html" },
                { name: "Tamil (2025) Movies", url: "/category/Tamil-(2025)-Movies.html" },
                { name: "Telugu Dubbed Hollywood", url: "/category/Telugu-Dubbed-Movies-[Hollywood].html" },
                { name: "HOT Web Series", url: "/category/HOT-Web-Series.html" }
            ];

            const homeData = {};
            
            for (const cat of categories) {
                try {
                    const html = await _fetch(_fixUrl(cat.url));
                    const items = _parseSearchResults(html);
                    if (items.length > 0) {
                        homeData[cat.name] = items;
                    }
                } catch (e) {}
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    async function search(query, cb) {
        try {
            const fixedQuery = query.replace(/\s+/g, "+");
            const searchUrl = `${MAIN_URL}/search.php?q=${fixedQuery}`;
            const html = await _fetch(searchUrl);
            const results = _parseSearchResults(html);
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    async function load(url, cb) {
        try {
            const html = await _fetch(url);
            
            let title = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]?.trim();
            if (!title) {
                title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.split("-")[0]?.trim();
            }
            
            const posterMatch = html.match(/<img[^>]+src="([^"]*\/poster\/[^"]*)"/);
            const posterUrl = posterMatch ? _fixUrl(posterMatch[1]) : "";
            
            let description = "";
            const descMatch = html.match(/Desc\/Plot[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
            if (descMatch) {
                description = descMatch[1].replace(/<[^>]*>/g, "").trim();
            } else {
                const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
                if (pMatch) description = pMatch[1].replace(/<[^>]*>/g, "").trim();
            }
            
            const yearMatch = html.match(/(\d{4})/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            
            const isSeries = /(season|episodes?|eps|all episodes|web series)/i.test(title || "");
            
            const episodeLinks = [];
            const epRegex = /<div class="catList">[\s\S]*?<a[^>]+href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
            let match;
            while ((match = epRegex.exec(html)) !== null) {
                const epUrl = _fixUrl(match[1]);
                const epName = match[2].replace(/<[^>]*>/g, "").trim();
                
                const sMatch = epName.match(/Season\s*(\d+)/i);
                const eMatch = epName.match(/Eps?\s*\(?(\d+)/i);
                
                episodeLinks.push(new Episode({
                    name: epName,
                    url: epUrl,
                    season: sMatch ? parseInt(sMatch[1]) : 1,
                    episode: eMatch ? parseInt(eMatch[1]) : (episodeLinks.length + 1)
                }));
            }
            
            const item = new MultimediaItem({
                title: title || "Unknown",
                url: url,
                posterUrl: posterUrl,
                type: isSeries ? "series" : "movie",
                description: description,
                year: year
            });
            
            if (episodeLinks.length > 0) {
                item.episodes = episodeLinks;
            } else {
                item.episodes = [new Episode({
                    name: title || "Full Movie",
                    url: url,
                    season: 1,
                    episode: 1
                })];
            }
            
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const html = await _fetch(url);
            const streams = [];
            
            const dlRegex = /<a[^>]+href=["']([^"']*dwload\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;
            let match;
            
            while ((match = dlRegex.exec(html)) !== null) {
                const dlPageUrl = _fixUrl(match[1].replace("dwload.php", "download.php"));
                const linkText = match[2].replace(/<[^>]*>/g, "").trim();
                
                let quality = "Unknown";
                if (/1080p/i.test(linkText)) quality = "1080p";
                else if (/720p/i.test(linkText)) quality = "720p";
                else if (/480p/i.test(linkText)) quality = "480p";
                else if (/360p/i.test(linkText)) quality = "360p";
                else if (/320p/i.test(linkText)) quality = "320p";

                try {
                    const dlHtml = await _fetch(dlPageUrl);
                    const fastDlMatch = dlHtml.match(/<a[^>]+href=["']([^"']*)["'][^>]*>Fast Download Server<\/a>/i);
                    const finalUrl = fastDlMatch ? _fixUrl(fastDlMatch[1]) : dlPageUrl;
                    
                    streams.push(new StreamResult({
                        url: finalUrl,
                        quality: quality,
                        headers: { "Referer": MAIN_URL }
                    }));
                } catch (e) {
                    streams.push(new StreamResult({
                        url: dlPageUrl,
                        quality: quality,
                        headers: { "Referer": MAIN_URL }
                    }));
                }
            }
            
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
