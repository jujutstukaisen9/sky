(function () {
    
    const UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36";

    const BASE_HEADERS = { "User-Agent": UA };

    /**
     * Six Kotlin mainPage categories.
     * "Trending" is a SkyStream reserved name → Hero Carousel at the top.
     */
    const CATEGORIES = [
        { name: "Trending",                path: "/category/Telugu-(2026)-Movies.html"             },
        { name: "Telugu (2025) Movies",    path: "/category/Telugu-(2025)-Movies.html"             },
        { name: "Tamil (2026) Movies",     path: "/category/Tamil-(2026)-Movies.html"              },
        { name: "Tamil (2025) Movies",     path: "/category/Tamil-(2025)-Movies.html"              },
        { name: "Telugu Dubbed Hollywood", path: "/category/Telugu-Dubbed-Movies-[Hollywood].html" },
        { name: "HOT Web Series",          path: "/category/HOT-Web-Series.html"                   },
    ];

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 2 · HELPERS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * fixUrl(u)  — BUG 4 FIX
     * Resolves any URL to an absolute one.
     * Rewrites ALL moviezwap.* host names to manifest.baseUrl so that stale
     * .surf / .org / .guru links in scraped HTML transparently become .toys.
     */
    function fixUrl(u) {
        if (!u) return "";
        u = u.trim();

        // Normalise any moviezwap domain variant → manifest.baseUrl
        const mzRe = /^(https?:\/\/(?:www\.)?moviezwap\.\w+)(\/?.*)$/i.exec(u);
        if (mzRe) {
            const base = (manifest.baseUrl || "").replace(/\/$/, "");
            return base + (mzRe[2] || "");
        }

        if (u.startsWith("http")) return u;
        if (u.startsWith("//"))   return "https:" + u;
        const base = (manifest.baseUrl || "").replace(/\/$/, "");
        if (u.startsWith("/"))    return base + u;
        return base + "/" + u;
    }

    /** Strip HTML tags + decode entities. */
    function decodeHtml(h) {
        if (!h) return "";
        return h
            .replace(/<[^>]*>/g, " ")
            .replace(/&amp;/g,   "&")
            .replace(/&lt;/g,    "<")
            .replace(/&gt;/g,    ">")
            .replace(/&quot;/g,  '"')
            .replace(/&#039;/g,  "'")
            .replace(/&apos;/g,  "'")
            .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
            .replace(/\s{2,}/g,  " ")
            .trim();
    }

    /** Derive a quality label from any text string. */
    function getQuality(text) {
        if (!text) return "Auto";
        const t = text.toLowerCase();
        if (t.includes("2160") || t.includes("4k"))  return "2160p";
        if (t.includes("1080"))  return "1080p";
        if (t.includes("720"))   return "720p";
        if (t.includes("480"))   return "480p";
        if (t.includes("360"))   return "360p";
        if (t.includes("320"))   return "320p";
        const m = /(\d{3,4})[pP]/.exec(text);
        if (m) return m[1] + "p";
        return "Auto";
    }

    /** True when a title looks like a series / web-series. */
    function isSeries(title) {
        return /\b(season|episodes?|ep\.?s?|all\s+episodes?|web\s+series)\b/i.test(title || "");
    }

    /**
     * buildPaginatedUrl(basePath, page)
     * Kotlin pagination mirror:  Name.html → Name/2.html
     */
    function buildPaginatedUrl(basePath, page) {
        const base = (manifest.baseUrl || "").replace(/\/$/, "");
        if (page <= 1) return base + basePath;
        return base + basePath.replace(/\.html$/i, "") + "/" + page + ".html";
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 3 · parseMovieLinks  — BUG 1 FIX
    // ─────────────────────────────────────────────────────────────────────

    /**
     * v1 bug: only matched  a[href*='/movie/']  which hit sidebar "Movies of
     * the Day" widgets — so every category showed the same 2 items.
     *
     * v2 fix: primary pattern is  getlinks_XXXXX.html  (real .toys file URLs),
     * with /movie/ kept as a secondary fallback for pages that still use it.
     */
    function parseMovieLinks(html, seen) {
        const items = [];

        function pushItem(href, innerHtml) {
            href = (href || "").trim();
            if (!href) return;

            const fullUrl = fixUrl(href);
            if (seen.has(fullUrl)) return;
            seen.add(fullUrl);

            let title = decodeHtml(innerHtml);
            if (!title || title.length < 2) {
                title = href.split("/").pop()
                    .replace(/\.html?$/i, "")
                    .replace(/_\d+$/,     "")   // strip numeric suffix from getlinks_
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, c => c.toUpperCase())
                    .trim();
            }
            if (!title || title.length < 2) return;

            items.push(new MultimediaItem({
                title,
                url:       fullUrl,
                posterUrl: "",
                type:      isSeries(title) ? "series" : "movie",
            }));
        }

        // PRIMARY: getlinks_XXXXX.html  — current .toys per-file page format
        const priRe = /<a\s[^>]*href="([^"]*getlinks_\d+\.html[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = priRe.exec(html)) !== null) pushItem(m[1], m[2]);

        // SECONDARY: /movie/ paths — legacy fallback (also used by search results)
        const secRe = /<a\s[^>]*href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = secRe.exec(html)) !== null) pushItem(m[1], m[2]);

        return items;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 4 · getHome
    // ─────────────────────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const homeData = {};
            for (const cat of CATEGORIES) {
                try {
                    const url = buildPaginatedUrl(cat.path, 1);
                    const res = await http_get(url, BASE_HEADERS);
                    if (res.status !== 200) continue;
                    const items = parseMovieLinks(res.body, new Set());
                    if (items.length > 0) homeData[cat.name] = items;
                } catch (e) {
                    console.error("[Moviezwap] getHome [" + cat.name + "]: " + e.message);
                }
            }
            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 5 · search
    // ─────────────────────────────────────────────────────────────────────

    async function search(query, cb) {
        try {
            const fixedQuery = query.trim().replace(/\s+/g, "+");
            const searchUrl  = (manifest.baseUrl || "").replace(/\/$/, "") +
                               "/search.php?q=" + encodeURIComponent(fixedQuery);
            const res = await http_get(searchUrl, BASE_HEADERS);
            if (res.status !== 200) return cb({ success: true, data: [] });
            cb({ success: true, data: parseMovieLinks(res.body, new Set()) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 6 · load  — BUG 2 + BUG 4 FIX
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Supports two page structures:
     *
     *   STRUCTURE A – getlinks_XXXXX.html  (current .toys)
     *     Table rows:  <td>File Name :</td> <td>Movie Title (2024) 720p.mp4</td>
     *                  <td>File Size :</td> <td>395 MB</td>
     *     One video file per page → single Episode pointing back to this URL.
     *     loadStreams() will follow the extlinks_*.html link found on this page.
     *
     *   STRUCTURE B – /movie/*.html  (legacy .surf pages, or future mirrors)
     *     h2 title, img with src containing poster, Desc/Plot td, Release Date td,
     *     div.catList episode links for series.
     *
     * fixUrl() normalises any stale domain before fetching.
     */
    async function load(url, cb) {
        try {
            const safeUrl = fixUrl(url);
            const res = await http_get(safeUrl, BASE_HEADERS);
            if (res.status !== 200) {
                return cb({ success: false, errorCode: "SITE_OFFLINE" });
            }

            const html           = res.body;
            const isGetlinksPage = /getlinks_\d+/i.test(safeUrl);

            // ── Title ────────────────────────────────────────────────
            let title = null;

            if (isGetlinksPage) {
                // Table row: "File Name : <filename.mp4>"
                const fnM =
                    /<td[^>]*>[^<]*File\s*Name\s*:?\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html) ||
                    /<strong>[^<]*File\s*Name[^<]*<\/strong>[^:]*:?\s*([\s\S]*?)(?:<br|<\/td|<\/p)/i.exec(html) ||
                    /<td[^>]*>([^<]{10,}(?:\.mp4|\.mkv|\.avi|\.3gp|\.webm)[^<]*)<\/td>/i.exec(html);
                if (fnM) title = decodeHtml(fnM[1]);
            }

            // Universal fallback cascade
            if (!title || title.length < 3) {
                const h2M = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
                if (h2M) title = decodeHtml(h2M[1]);
            }
            if (!title || title.length < 3) {
                const h1M = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
                if (h1M) title = decodeHtml(h1M[1]);
            }
            if (!title || title.length < 3) {
                const ogM = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html);
                if (ogM) title = decodeHtml(ogM[1]);
            }
            if (!title || title.length < 3) {
                const ttM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
                if (ttM) title = decodeHtml(ttM[1]).split("|")[0].split("-")[0].split("–")[0].trim();
            }
            if (!title || title.length < 3) {
                // Last resort: slug
                title = safeUrl.split("/").pop()
                    .replace(/\.html?$/i, "")
                    .replace(/_\d+$/,     "")
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, c => c.toUpperCase())
                    .trim();
            }
            if (!title || title.length < 3) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "Cannot find title" });
            }

            // ── Poster ───────────────────────────────────────────────
            let poster = "";
            const postM = /<img[^>]+src="([^"]*\/poster\/[^"]*)"[^>]*>/i.exec(html);
            if (postM) poster = fixUrl(postM[1]);
            if (!poster) {
                const ogIM = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
                if (ogIM) poster = ogIM[1];
            }

            // ── Description ──────────────────────────────────────────
            let description = "";
            if (isGetlinksPage) {
                const fsM =
                    /<td[^>]*>[^<]*File\s*Size\s*:?\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html) ||
                    /<strong>[^<]*File\s*Size[^<]*<\/strong>[^:]*:?\s*([\s\S]*?)(?:<br|<\/td|<\/p)/i.exec(html);
                if (fsM) description = "File Size: " + decodeHtml(fsM[1]);
                const q = getQuality(title);
                if (q !== "Auto") description += (description ? " · " : "") + "Quality: " + q;
            } else {
                const descM = /<td[^>]*>[^<]*(?:Desc\/Plot|Description|Plot)[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
                if (descM) description = decodeHtml(descM[1]);
                if (!description) {
                    const pM = /<p[^>]*>([\s\S]{30,}?)<\/p>/i.exec(html);
                    if (pM) description = decodeHtml(pM[1]);
                }
            }

            // ── Year ─────────────────────────────────────────────────
            let year = null;
            const yrFromTitle = /\((\d{4})\)/.exec(title);
            if (yrFromTitle) {
                year = parseInt(yrFromTitle[1]);
            } else {
                const rdM  = /<td[^>]*>[^<]*Release\s+Date[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
                const catM = /<td[^>]*>[^<]*Category[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
                const yrSrc = rdM  ? rdM[1].replace(/<[^>]*>/g, "")
                            : catM ? catM[1].replace(/<[^>]*>/g, "") : "";
                const yrM2 = /(\d{4})/.exec(yrSrc);
                if (yrM2) year = parseInt(yrM2[1]);
            }

            // ── Series detection ─────────────────────────────────────
            const seriesFlag = isSeries(title);

            // ── Series branch (legacy pages with div.catList) ────────
            if (seriesFlag && !isGetlinksPage) {
                const clM  = /<div[^>]*class="[^"]*catList[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
                const scope = clM ? clM[1] : html;
                const episodes = [];
                const epRe = /<a\s[^>]*href="([^"]*(?:getlinks_\d+|\/movie\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
                let ep; let idx = 0;
                while ((ep = epRe.exec(scope)) !== null) {
                    const epHref  = ep[1].trim();
                    const epLabel = decodeHtml(ep[2]) || ("Episode " + (idx + 1));
                    const snM = /Season\s*(\d+)/i.exec(epLabel);
                    const enM = /Eps?\s*\(?(\d+)/i.exec(epLabel);
                    episodes.push(new Episode({
                        name:    epLabel,
                        url:     fixUrl(epHref),
                        season:  snM ? parseInt(snM[1]) : 1,
                        episode: enM ? parseInt(enM[1]) : idx + 1,
                    }));
                    idx++;
                }
                if (episodes.length > 0) {
                    return cb({
                        success: true,
                        data: new MultimediaItem({
                            title, url: safeUrl, posterUrl: poster, type: "series",
                            description: description || undefined, year: year || undefined,
                            episodes,
                        })
                    });
                }
            }

            // ── Movie / single-file branch ───────────────────────────
            cb({
                success: true,
                data: new MultimediaItem({
                    title, url: safeUrl, posterUrl: poster,
                    type:        seriesFlag ? "series" : "movie",
                    description: description || undefined,
                    year:        year || undefined,
                    episodes: [
                        new Episode({ name: "Full Movie", url: safeUrl, season: 1, episode: 1 })
                    ],
                })
            });

        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 7 · loadStreams  — BUG 3 + BUG 4 FIX
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Three-chain download resolution (newest → oldest):
     *
     *   CHAIN A — extlinks_*.html  (primary, current .toys)
     *     getlinks_*.html page → link to extlinks_*.html
     *                          → external file host link
     *
     *   CHAIN B — dwload.php / download.php  (legacy .surf style)
     *     dwload.php link → download.php page → "Fast Download Server" anchor
     *
     *   CHAIN C — direct sweep  (last resort)
     *     Any non-moviezwap link on the page matching a video host pattern
     */
    async function loadStreams(url, cb) {
        try {
            const safeUrl = fixUrl(url);
            const res = await http_get(safeUrl, BASE_HEADERS);
            if (res.status !== 200) return cb({ success: true, data: [] });

            const html    = res.body;
            const results = [];
            const seen    = new Set();

            // ── CHAIN A · extlinks_*.html ─────────────────────────────
            const extRe = /href="([^"]*extlinks_\d+\.html[^"]*)"/gi;
            let m;
            while ((m = extRe.exec(html)) !== null) {
                const extUrl = fixUrl(m[1]);
                if (seen.has(extUrl)) continue;
                seen.add(extUrl);

                try {
                    const extRes = await http_get(extUrl, { ...BASE_HEADERS, Referer: safeUrl });
                    if (extRes.status !== 200) continue;

                    const extHtml   = extRes.body;
                    const extLinkRe = /href="(https?:\/\/[^"]+)"/gi;
                    let lm;
                    while ((lm = extLinkRe.exec(extHtml)) !== null) {
                        const finalUrl = lm[1];
                        if (/moviezwap|telegram\.me|t\.me|whatsapp/i.test(finalUrl)) continue;
                        if (seen.has(finalUrl)) continue;
                        seen.add(finalUrl);

                        results.push(new StreamResult({
                            url:     finalUrl,
                            quality: getQuality(finalUrl + " " + safeUrl),
                            headers: { "User-Agent": UA, "Referer": extUrl },
                        }));
                    }
                } catch (e) {
                    console.error("[Moviezwap] Chain A extlinks error: " + e.message);
                }
            }

            // ── CHAIN B · dwload.php → download.php ──────────────────
            const dwRe = /href="([^"]*dwload\.php[^"]*)"/gi;
            while ((m = dwRe.exec(html)) !== null) {
                const dlPageUrl = fixUrl(m[1].replace("dwload.php", "download.php"));
                if (seen.has(dlPageUrl)) continue;
                seen.add(dlPageUrl);

                try {
                    const dlRes = await http_get(dlPageUrl, { ...BASE_HEADERS, Referer: safeUrl });
                    if (dlRes.status !== 200) continue;
                    const dlHtml = dlRes.body;

                    let finalUrl = null;
                    const fastM = /href="([^"]+)"[^>]*>[^<]*Fast\s+Download\s+Server[^<]*</i.exec(dlHtml);
                    if (fastM) finalUrl = fastM[1];
                    if (!finalUrl) {
                        const vidM = /href="(https?:\/\/[^"]+\.(mp4|mkv|avi|m3u8)[^"]*)"/i.exec(dlHtml);
                        if (vidM) finalUrl = vidM[1];
                    }
                    if (!finalUrl) {
                        const anyM = /href="(https?:\/\/(?!(?:www\.)?moviezwap)[^"]+)"/i.exec(dlHtml);
                        if (anyM) finalUrl = anyM[1];
                    }
                    if (!finalUrl) finalUrl = dlPageUrl;
                    if (seen.has(finalUrl)) continue;
                    seen.add(finalUrl);

                    results.push(new StreamResult({
                        url:     finalUrl,
                        quality: getQuality(safeUrl),
                        headers: { "User-Agent": UA, "Referer": dlPageUrl },
                    }));
                } catch (e) {
                    console.error("[Moviezwap] Chain B dwload error: " + e.message);
                }
            }

            // ── CHAIN C · Direct sweep (last resort) ──────────────────
            if (results.length === 0) {
                const directRe = /href="(https?:\/\/[^"]+)"/gi;
                while ((m = directRe.exec(html)) !== null) {
                    const link = m[1];
                    if (/moviezwap|telegram\.me|t\.me|whatsapp/i.test(link)) continue;
                    // Only pick direct video files or known hosting services
                    const isVideoFile = /\.(mp4|mkv|avi|m3u8|3gp|webm)(\?|$)/i.test(link);
                    const isKnownHost = /drive\.google|mega\.nz|pixeldrain|gofile\.io|mediafire|terabox|1fichier/i.test(link);
                    if (!isVideoFile && !isKnownHost) continue;
                    if (seen.has(link)) continue;
                    seen.add(link);

                    results.push(new StreamResult({
                        url:     link,
                        quality: getQuality(link + " " + safeUrl),
                        headers: { "User-Agent": UA, "Referer": safeUrl },
                    }));
                }
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 8 · EXPORT
    // ─────────────────────────────────────────────────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
