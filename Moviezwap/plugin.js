(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

    const BASE_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": `${manifest.baseUrl}/`
    };

    function normalizeUrl(url, base) {
        if (!url) return "";
        const raw = String(url).trim();
        if (!raw) return "";
        if (raw.startsWith("//")) return `https:${raw}`;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.startsWith("/")) return `${base}${raw}`;
        return `${base}/${raw}`;
    }

    function resolveUrl(base, next) {
        try {
            return new URL(String(next || ""), String(base || manifest.baseUrl)).toString();
        } catch (_) {
            return normalizeUrl(next, manifest.baseUrl);
        }
    }

    function textOf(el) {
        if (!el) return "";
        return (el.textContent || "").replace(/\s+/g, " ").trim();
    }

    function getAttr(el, ...attrs) {
        if (!el) return "";
        for (const attr of attrs) {
            const v = el.getAttribute(attr);
            if (v && String(v).trim()) return String(v).trim();
        }
        return "";
    }

    function htmlDecode(text) {
        if (!text) return "";
        return String(text)
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    }

    function stripTags(str) {
        if (!str) return "";
        return str.replace(/<[^>]*>/g, "").trim();
    }

    function cleanTitle(raw) {
        if (!raw) return "Unknown";
        let t = htmlDecode(String(raw)).replace(/\s+/g, " ").trim();
        return t;
    }

    function extractQuality(text) {
        const t = String(text || "").toLowerCase();
        if (t.includes("1080")) return 1080;
        if (t.includes("720")) return 720;
        if (t.includes("480")) return 480;
        if (t.includes("360")) return 360;
        if (t.includes("320")) return 320;
        if (t.includes("240")) return 240;
        return 0;
    }

    async function request(url, headers = {}) {
        return http_get(url, { headers: Object.assign({}, BASE_HEADERS, headers) });
    }

    async function loadDoc(url, headers = {}) {
        const res = await request(url, headers);
        return await parseHtml(res.body);
    }

    function parseItemFromElement(el) {
        if (!el) return null;

        const anchor = el.tagName === "A" ? el : el.querySelector("a");
        const href = getAttr(anchor, "href");
        if (!href || !href.includes("/movie/")) return null;

        const fullUrl = normalizeUrl(href, manifest.baseUrl);
        
        let title = textOf(anchor) || textOf(el);
        if (!title || title === "Unknown") {
            const parts = href.split("/");
            const lastPart = parts[parts.length - 1] || "";
            title = lastPart.replace(".html", "").replace(/-/g, " ");
        }
        title = cleanTitle(title);
        if (!title) return null;

        const isSeries = /season|episode|eps|web series/i.test(title);

        const img = el.querySelector("img");
        const posterUrl = img ? normalizeUrl(getAttr(img, "src", "data-src"), manifest.baseUrl) : null;

        return new MultimediaItem({
            title,
            url: fullUrl,
            posterUrl,
            type: isSeries ? "series" : "movie",
            contentType: isSeries ? "series" : "movie"
        });
    }

    async function fetchSection(path, page = 1) {
        let url;
        if (page === 1) {
            url = `${manifest.baseUrl}${path}`;
        } else {
            url = `${manifest.baseUrl}${path.replace(".html", "")}/${page}.html`;
        }

        try {
            const doc = await loadDoc(url);
            const items = Array.from(doc.querySelectorAll("a[href*='/movie/']"))
                .map(parseItemFromElement)
                .filter(Boolean);

            const uniqueItems = [];
            const seen = new Set();
            for (const item of items) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    uniqueItems.push(item);
                }
            }
            return uniqueItems;
        } catch (e) {
            console.error(`Error fetching section ${path}: ${e.message}`);
            return [];
        }
    }

    async function getHome(cb) {
        try {
            const sections = [
                { name: "Telugu (2026) Movies", path: "/category/Telugu-(2026)-Movies.html" },
                { name: "Telugu (2025) Movies", path: "/category/Telugu-(2025)-Movies.html" },
                { name: "Tamil (2026) Movies", path: "/category/Tamil-(2026)-Movies.html" },
                { name: "Tamil (2025) Movies", path: "/category/Tamil-(2025)-Movies.html" },
                { name: "Telugu Dubbed Hollywood", path: "/category/Telugu-Dubbed-Movies-[Hollywood].html" },
                { name: "HOT Web Series", path: "/category/HOT-Web-Series.html" }
            ];

            const data = {};
            for (const sec of sections) {
                try {
                    const items = await fetchSection(sec.path, 1);
                    if (items && items.length > 0) {
                        data[sec.name] = items.slice(0, 24);
                    }
                } catch (e) {
                    console.error(`Section [${sec.name}] failed: ${e.message}`);
                }
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const encoded = encodeURIComponent(query.replace(" ", "+"));
            const url = `${manifest.baseUrl}/search.php?q=${encoded}`;

            const doc = await loadDoc(url);
            const items = Array.from(doc.querySelectorAll("a[href*='/movie/']"))
                .map(parseItemFromElement)
                .filter(Boolean);

            const uniqueItems = [];
            const seen = new Set();
            for (const item of items) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    uniqueItems.push(item);
                }
            }

            const queryLower = query.toLowerCase();
            const scored = uniqueItems.map(item => {
                const titleLower = item.title.toLowerCase();
                let score = 0;
                if (titleLower.includes(queryLower)) score = 3;
                else {
                    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
                    const allMatch = queryWords.every(word => titleLower.includes(word));
                    if (allMatch) score = 2;
                    else if (queryWords.some(word => titleLower.includes(word))) score = 1;
                }
                return { item, score };
            }).filter(s => s.score > 0);

            scored.sort((a, b) => b.score - a.score);

            cb({ success: true, data: scored.map(s => s.item) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const doc = await loadDoc(url);

            const title = textOf(doc.querySelector("h2")) || 
                          doc.querySelector("title")?.textContent?.split("-")?.[0]?.trim() ||
                          "Unknown";

            const posterMatch = doc.querySelector("img[src*='/poster/']");
            const posterUrl = posterMatch ? normalizeUrl(getAttr(posterMatch, "src"), manifest.baseUrl) : null;

            const allTds = doc.querySelectorAll("td");
            let description = "";
            let yearText = "";
            
            for (const td of allTds) {
                const text = textOf(td).toLowerCase();
                if (text.includes("desc") || text.includes("plot")) {
                    const next = td.nextElementSibling;
                    if (next) description = textOf(next);
                }
                if (text.includes("release") || text.includes("date")) {
                    const next = td.nextElementSibling;
                    if (next) yearText = textOf(next);
                }
                if (text.includes("category")) {
                    const next = td.nextElementSibling;
                    if (next) yearText = yearText || textOf(next);
                }
            }

            if (!description) {
                const p = doc.querySelector("p");
                description = p ? textOf(p) : "";
            }

            const yearMatch = yearText.match(/(\d{4})/);
            const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

            const isSeries = /season|episode|eps|web series/i.test(title);
            const seasonLinks = doc.querySelectorAll("div.catList a[href*='/movie/']");

            if (isSeries && seasonLinks.length > 0) {
                const episodes = Array.from(seasonLinks).map(el => {
                    const epTitle = textOf(el);
                    const epUrl = normalizeUrl(getAttr(el, "href"), manifest.baseUrl);

                    const seasonMatch = epTitle.match(/Season\s*(\d+)/i);
                    const episodeMatch = epTitle.match(/Eps?\s*\(?(\d+)(?:\s*to\s*(\d+))?\)?/i);

                    const season = seasonMatch ? parseInt(seasonMatch[1]) : 1;
                    const episode = episodeMatch ? parseInt(episodeMatch[1]) : 1;

                    return new Episode({
                        name: epTitle,
                        url: epUrl,
                        season,
                        episode
                    });
                });

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: cleanTitle(title),
                        url,
                        posterUrl,
                        type: "series",
                        description: htmlDecode(description),
                        year,
                        episodes
                    })
                });
            } else {
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: cleanTitle(title),
                        url,
                        posterUrl,
                        type: "movie",
                        description: htmlDecode(description),
                        year,
                        episodes: [
                            new Episode({
                                name: "Movie",
                                url: url,
                                season: 1,
                                episode: 1
                            })
                        ]
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const doc = await loadDoc(url);
            
            const downloadLinks = Array.from(doc.querySelectorAll("a[href*='dwload.php']"));
            
            const results = [];
            const seen = new Set();

            for (const linkEl of downloadLinks) {
                let href = getAttr(linkEl, "href");
                if (!href) continue;

                href = href.replace("dwload.php", "download.php");
                const downloadPageUrl = normalizeUrl(href, manifest.baseUrl);
                const linkText = textOf(linkEl);

                const quality = extractQuality(linkText);

                let actualDownloadUrl = downloadPageUrl;
                try {
                    const downloadDoc = await loadDoc(downloadPageUrl);
                    const allAnchors = downloadDoc.querySelectorAll("a");
                    let fastLink = null;
                    for (const a of allAnchors) {
                        const linkTextLower = textOf(a).toLowerCase();
                        if (linkTextLower.includes("fast") && linkTextLower.includes("download")) {
                            fastLink = a;
                            break;
                        }
                    }
                    if (fastLink) {
                        actualDownloadUrl = normalizeUrl(getAttr(fastLink, "href"), manifest.baseUrl);
                    }
                } catch (e) {
                    console.error(`Error fetching download page: ${e.message}`);
                }

                if (!seen.has(actualDownloadUrl)) {
                    seen.add(actualDownloadUrl);
                    results.push(new StreamResult({
                        url: actualDownloadUrl,
                        quality: quality || "Auto",
                        source: `${manifest.name || "Moviezwap"} - ${linkText}`,
                        headers: { "Referer": manifest.baseUrl, "User-Agent": UA }
                    }));
                }
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
