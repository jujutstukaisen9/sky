/**
 * SkyStream Plugin for TellyBiz.in
 * Scrapes movie download links from tellybiz.in
 */

(function() {
    /**
    * @type {import('@skystream/sdk').Manifest}
    */
    const BASE_URL = "https://tellybiz.in";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": BASE_URL + "/"
    };

    function fixUrl(url, base) {
        if (!url) return "";
        const raw = String(url).trim();
        if (!raw) return "";
        if (raw.startsWith("//")) return "https:" + raw;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.startsWith("/")) return (base || BASE_URL) + raw;
        return (base || BASE_URL) + "/" + raw;
    }

    function decodeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    }

    function textOf(el) {
        if (!el) return "";
        return decodeHtml((el.textContent || "").replace(/\s+/g, " ").trim());
    }

    function getAttr(el, ...attrs) {
        if (!el) return "";
        for (const attr of attrs) {
            const v = el.getAttribute(attr);
            if (v && String(v).trim()) return String(v).trim();
        }
        return "";
    }

    function parseYear(text) {
        const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : undefined;
    }

    function uniqueByUrl(items) {
        const out = [];
        const seen = new Set();
        for (const it of items || []) {
            if (!it?.url || seen.has(it.url)) continue;
            seen.add(it.url);
            out.push(it);
        }
        return out;
    }

    function cleanTitle(raw) {
        return decodeHtml(String(raw || "")
            .replace(/\s+/g, " ")
            .trim());
    }

    function getQuality(text) {
        if (!text) return "Auto";
        const t = String(text).toLowerCase();
        if (t.includes("2160") || t.includes("4k")) return "4K";
        if (t.includes("1080")) return "1080p";
        if (t.includes("720")) return "720p";
        if (t.includes("480")) return "480p";
        if (t.includes("360")) return "360p";
        const m = t.match(/(\d{3,4})p/);
        if (m) return m[1] + "p";
        return "Auto";
    }

    async function request(url, headers = {}) {
        return http_get(url, {
            headers: Object.assign({}, HEADERS, headers)
        });
    }

    async function loadDoc(url, headers = {}) {
        const res = await request(url, headers);
        if (!res || !res.body) return null;
        return parseHtml(res.body);
    }

    function parseMovieCard(card) {
        if (!card) return null;

        // Find the link - could be in various structures
        const a = card.querySelector("a[href*='loanid.php']") ||
                  card.querySelector("a[href*='lid=']") ||
                  card.querySelector("a");

        const href = getAttr(a, "href");
        if (!href || !href.includes("loanid.php")) return null;

        const title = textOf(card.querySelector(".movie-title")) ||
                     textOf(card.querySelector("h3")) ||
                     textOf(card.querySelector("h2")) ||
                     getAttr(a, "title") ||
                     getAttr(card.querySelector("img"), "alt");

        if (!title) return null;

        const poster = getAttr(card.querySelector("img"), "data-src", "src") ||
                      getAttr(card.querySelector(".movie-poster"), "data-src", "src");

        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

        return new MultimediaItem({
            title: cleanTitle(title),
            url: fixUrl(href),
            posterUrl: fixUrl(poster),
            type: "movie",
            year: year
        });
    }

    function collectMovies(doc) {
        const cards = Array.from(doc.querySelectorAll(".movie-card, article, .poster-wrap"));
        const out = [];
        for (const card of cards) {
            const item = parseMovieCard(card);
            if (item) out.push(item);
        }
        return uniqueByUrl(out);
    }

    // Function to extract download links from loanagreement.php page
    async function extractDownloadLinks(pageUrl) {
        try {
            const res = await request(pageUrl);
            if (!res || !res.body) return [];

            const body = String(res.body);
            const links = [];

            // Pattern 1: Direct CDN links like https://cdn.cdngo.site/...
            const cdnPattern = /https?:\/\/cdn\.[^\s"'<>]+\.(mkv|mp4|avi)[^\s"'<>]*/gi;
            let match;
            while ((match = cdnPattern.exec(body)) !== null) {
                const url = match[0];
                const filename = url.split("/").pop();
                const quality = getQuality(filename);
                links.push(new StreamResult({
                    url: url,
                    source: "Direct Download",
                    quality: quality
                }));
            }

            // Pattern 2: Links in JavaScript variables
            const jsPatterns = [
                /window\.location\.href\s*=\s*["']([^"']+)["']/gi,
                /var\s+\w+\s*=\s*["']([^"']+\.(mkv|mp4|avi)[^"']*)["']/gi,
                /src\s*=\s*["']([^"']+\.(mkv|mp4|avi)[^"']*)["']/gi
            ];

            for (const pattern of jsPatterns) {
                while ((match = pattern.exec(body)) !== null) {
                    const url = match[1];
                    if (url.startsWith("http") && !links.some(l => l.url === url)) {
                        const filename = url.split("/").pop();
                        const quality = getQuality(filename);
                        links.push(new StreamResult({
                            url: url,
                            source: "Direct Download",
                            quality: quality
                        }));
                    }
                }
            }

            // Pattern 3: Link tags in HTML
            const linkPattern = /<a[^>]+href=["']([^"']+\.(?:mkv|mp4|avi)[^"']*)["'][^>]*>/gi;
            while ((match = linkPattern.exec(body)) !== null) {
                const url = match[1];
                if (url.startsWith("http") && !links.some(l => l.url === url)) {
                    const filename = url.split("/").pop();
                    const quality = getQuality(filename);
                    links.push(new StreamResult({
                        url: url,
                        source: "Direct Download",
                        quality: quality
                    }));
                }
            }

            return links;
        } catch (e) {
            console.error("Error extracting download links:", e);
            return [];
        }
    }

    async function getHome(cb) {
        try {
            const data = {};
            const sections = [
                { name: "Latest Updates", path: "/index.php" },
                { name: "Trending", path: "/index.php?sort=trending" },
                { name: "Bollywood", path: "/category.php?cat=bollywood" },
                { name: "Hollywood", path: "/category.php?cat=hollywood" },
                { name: "South Movies", path: "/category.php?cat=south" }
            ];

            for (const section of sections) {
                let items = [];
                try {
                    const doc = await loadDoc(`${BASE_URL}${section.path}`);
                    if (doc) {
                        items = collectMovies(doc);
                    }
                } catch (_) {}

                items = uniqueByUrl(items).slice(0, 30);
                if (items.length > 0) {
                    data[section.name] = items;
                }
            }

            // If no sections found, try homepage directly
            if (Object.keys(data).length === 0) {
                const doc = await loadDoc(BASE_URL + "/index.php");
                if (doc) {
                    const items = collectMovies(doc);
                    if (items.length > 0) {
                        data["Movies"] = items.slice(0, 30);
                    }
                }
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const raw = String(query || "").trim();
            if (!raw) return cb({ success: true, data: [] });

            const q = encodeURIComponent(raw);
            const doc = await loadDoc(`${BASE_URL}/search.php?q=${q}`);

            if (!doc) {
                cb({ success: true, data: [] });
                return;
            }

            const items = collectMovies(doc);
            cb({ success: true, data: items.slice(0, 40) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const target = fixUrl(url, BASE_URL);
            const doc = await loadDoc(target);

            if (!doc) {
                cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load page" });
                return;
            }

            // Extract movie title
            const title = textOf(doc.querySelector(".movie-title, h1, h2.title")) ||
                         textOf(doc.querySelector('meta[property="og:title"]')) ||
                         "Unknown";

            // Extract poster
            const posterUrl = getAttr(doc.querySelector(".poster img, .movie-poster, img"), "src", "data-src") ||
                             getAttr(doc.querySelector('meta[property="og:image"]'), "content");

            // Extract description
            const description = textOf(doc.querySelector(".overview, .description, .synopsis, p")) ||
                              textOf(doc.querySelector('meta[property="og:description"]'));

            // Extract year
            const yearText = textOf(doc.querySelector(".year, .movie-year"));
            const year = parseYear(yearText || title);

            // Extract rating
            const ratingText = textOf(doc.querySelector(".rating, .rating-badge"));
            const score = ratingText ? parseFloat(ratingText.replace(/[^\d.]/g, "")) || 0 : 0;

            // Extract genres
            const genreNodes = doc.querySelectorAll(".genres .genre-tag, .genre-tag, .genres span");
            const genres = Array.from(genreNodes).map(g => textOf(g));

            // Extract director info
            const director = textOf(doc.querySelector(".director-info span, .director"));

            // Extract cast
            const castNodes = doc.querySelectorAll(".cast-item, .cast span, .cast-list span");
            const cast = Array.from(castNodes).map(c => new Actor({ name: textOf(c) }));

            // Find quality download links from the page
            const qualityLinks = [];
            const fileItems = doc.querySelectorAll(".file-item, a[href*='loanagreement.php']");

            for (const item of fileItems) {
                const href = getAttr(item, "href");
                const nameEl = item.querySelector(".file-name, .file-title");
                const name = textOf(nameEl) || textOf(item);
                const sizeEl = item.querySelector(".file-size");
                const size = textOf(sizeEl);

                if (href && href.includes("loanagreement.php")) {
                    qualityLinks.push({
                        name: name,
                        url: fixUrl(href),
                        size: size,
                        href: href
                    });
                }
            }

            // Create episodes with quality links
            const episodes = [];

            if (qualityLinks.length > 0) {
                // Store all quality links in the episode data
                episodes.push(new Episode({
                    name: title,
                    url: JSON.stringify(qualityLinks),
                    season: 1,
                    episode: 1,
                    posterUrl: fixUrl(posterUrl)
                }));
            } else {
                // If no direct links found, create episode pointing to the page for stream extraction
                episodes.push(new Episode({
                    name: title,
                    url: JSON.stringify([{ name: "Download Page", url: target, href: target }]),
                    season: 1,
                    episode: 1,
                    posterUrl: fixUrl(posterUrl)
                }));
            }

            const item = new MultimediaItem({
                title: cleanTitle(title),
                url: target,
                posterUrl: fixUrl(posterUrl),
                bannerUrl: fixUrl(posterUrl),
                description: description,
                type: "movie",
                year: year,
                score: score,
                tags: genres,
                cast: cast,
                episodes: episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            let qualityLinks = [];

            try {
                qualityLinks = JSON.parse(dataStr);
            } catch (_) {
                cb({ success: false, errorCode: "STREAM_ERROR", message: "Invalid data format" });
                return;
            }

            if (!Array.isArray(qualityLinks)) {
                qualityLinks = [qualityLinks];
            }

            const results = [];

            for (const linkData of qualityLinks) {
                try {
                    const pageUrl = linkData.url || linkData.href;
                    if (!pageUrl) continue;

                    // Check if it's already a direct download link
                    if (pageUrl.startsWith("http") &&
                        (pageUrl.includes(".mkv") || pageUrl.includes(".mp4") || pageUrl.includes(".avi"))) {
                        const quality = getQuality(pageUrl);
                        results.push(new StreamResult({
                            url: pageUrl,
                            source: "Direct Download",
                            quality: quality
                        }));
                        continue;
                    }

                    // If it's a loanagreement.php page, extract the download link
                    if (pageUrl.includes("loanagreement.php")) {
                        const links = await extractDownloadLinks(pageUrl);
                        results.push(...links);
                    } else {
                        // Try to extract links from any page
                        const links = await extractDownloadLinks(pageUrl);
                        if (links.length > 0) {
                            results.push(...links);
                        } else {
                            // If no direct links found, return the page URL as-is
                            const quality = getQuality(linkData.name || linkData.title || "");
                            results.push(new StreamResult({
                                url: pageUrl,
                                source: linkData.name || "Download",
                                quality: quality
                            }));
                        }
                    }
                } catch (_) {}
            }

            // Remove duplicates
            const seen = new Set();
            const finalResults = results.filter(r => {
                if (!r.url) return false;
                if (seen.has(r.url)) return false;
                seen.add(r.url);
                return true;
            });

            cb({ success: true, data: finalResults });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    // Export to global scope for SkyStream
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
