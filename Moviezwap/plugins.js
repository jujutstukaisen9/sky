(function () {
    /**
     * ═══════════════════════════════════════════════════════════════════════
     *  MOVIEZWAP  –  SkyStream Plugin (Sky Gen 2)
     *  Ported from: MoviezwapProvider.kt  (NivinCNC / CNCVerse-Cloud-Stream)
     *  Author:  NivinCNC  |  Language: Telugu (te), Tamil (ta)
     *  Type:    Movie + TvSeries
     * ═══════════════════════════════════════════════════════════════════════
     *
     * KOTLIN → JAVASCRIPT MIGRATION MAP
     * ──────────────────────────────────
     *  getMainPage()           → getHome(cb)
     *  search()                → search(query, cb)
     *  load()                  → load(url, cb)
     *  loadLinks()             → loadStreams(url, cb)
     *  Element.toSearchResult()→ parseMovieLinks() helper
     *  fixUrl()                → fixUrl() helper
     *  Qualities.P*            → getQuality() helper string
     *  newMovieSearchResponse  → new MultimediaItem({ type: "movie" })
     *  newTvSeriesLoadResponse → new MultimediaItem({ type: "series" })
     *  newEpisode()            → new Episode({})
     *  newExtractorLink()      → new StreamResult({})
     *
     * @type {import('@skystream/sdk').Manifest}
     * Note: `manifest` is injected at runtime by the SkyStream host.
     */

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 1 · CONSTANTS
    // ─────────────────────────────────────────────────────────────────────

    /** Standard browser User-Agent — keeps the remote server happy. */
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
               "AppleWebKit/537.36 (KHTML, like Gecko) " +
               "Chrome/124.0.0.0 Safari/537.36";

    const BASE_HEADERS = { "User-Agent": UA };

    /**
     * Home-page category list.
     * Mirrors the Kotlin `mainPage` companion object:
     *   "$mainUrl/category/Telugu-(2026)-Movies.html" to "Telugu (2026) Movies"  …
     *
     * The first entry is labelled "Trending" so SkyStream promotes it to the
     * Hero Carousel at the top of the dashboard.
     */
    const CATEGORIES = [
        // "Trending" is a reserved SkyStream name → gets Hero Carousel slot
        { name: "Trending",                 path: "/category/Telugu-(2026)-Movies.html" },
        { name: "Telugu (2025) Movies",     path: "/category/Telugu-(2025)-Movies.html" },
        { name: "Tamil (2026) Movies",      path: "/category/Tamil-(2026)-Movies.html" },
        { name: "Tamil (2025) Movies",      path: "/category/Tamil-(2025)-Movies.html" },
        { name: "Telugu Dubbed Hollywood",  path: "/category/Telugu-Dubbed-Movies-[Hollywood].html" },
        { name: "HOT Web Series",           path: "/category/HOT-Web-Series.html" },
    ];

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 2 · UTILITY HELPERS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * fixUrl(href)
     * Mirrors Kotlin CloudStream fixUrl() / fixUrlNull().
     * Resolves a possibly-relative href to an absolute URL using manifest.baseUrl.
     */
    function fixUrl(u) {
        if (!u) return "";
        u = u.trim();
        if (u.startsWith("http")) return u;
        if (u.startsWith("//"))   return "https:" + u;
        const base = (manifest.baseUrl || "").replace(/\/$/, "");
        if (u.startsWith("/"))    return base + u;
        return base + "/" + u;
    }

    /**
     * decodeHtml(str)
     * Strips HTML tags and decodes the most common HTML entities so that
     * scraped text is suitable for display.
     */
    function decodeHtml(h) {
        if (!h) return "";
        return h
            .replace(/<[^>]*>/g, "")
            .replace(/&amp;/g,   "&")
            .replace(/&lt;/g,    "<")
            .replace(/&gt;/g,    ">")
            .replace(/&quot;/g,  '"')
            .replace(/&#039;/g,  "'")
            .replace(/&apos;/g,  "'")
            .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
            .trim();
    }

    /**
     * getQuality(text)
     * Mirrors Kotlin quality detection:
     *   Qualities.P1080 / P720 / P480 / P360 / Unknown
     * Parses a link label or filename for a resolution badge.
     */
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

    /**
     * isSeries(title)
     * Mirrors Kotlin regex in toSearchResult():
     *   Regex("(?i)(season|episodes?|eps|all episodes|web series)")
     */
    function isSeries(title) {
        return /\b(season|episodes?|ep\.?s?|all\s+episodes?|web\s+series)\b/i.test(title || "");
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 3 · HTML SCRAPING HELPERS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * parseMovieLinks(html, seen)
     * Mirrors Kotlin Element.toSearchResult():
     *   document.select("a[href*='/movie/']")
     *
     * Scans raw HTML for every anchor whose href contains "/movie/".
     * Returns an array of MultimediaItem objects, deduplicated by `seen` Set.
     *
     * @param {string}  html  - Raw page HTML
     * @param {Set}     seen  - URL dedup set (mutated in-place)
     */
    function parseMovieLinks(html, seen) {
        const items = [];
        // Match anchors with /movie/ in href — mirrors Kotlin selector
        const re = /<a\s[^>]*href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;

        while ((m = re.exec(html)) !== null) {
            const href = m[1].trim();
            if (!href) continue;

            const fullUrl = fixUrl(href);
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            // Inner text of the anchor as the title
            let title = decodeHtml(m[2]);

            // Kotlin fallback: derive from URL slug when link text is empty
            if (!title || title.length < 2) {
                title = href
                    .split("/").pop()
                    .replace(/\.html?$/, "")
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, c => c.toUpperCase())
                    .trim();
            }

            if (!title || title.length < 2) continue;

            items.push(new MultimediaItem({
                title:     title,
                url:       fullUrl,
                posterUrl: "",           // poster is only on the detail page
                type:      isSeries(title) ? "series" : "movie",
            }));
        }

        return items;
    }

    /**
     * buildPaginatedUrl(basePath, page)
     * Mirrors Kotlin pagination logic inside getMainPage():
     *   page == 1  → /category/Name.html
     *   page > 1   → /category/Name/2.html
     */
    function buildPaginatedUrl(basePath, page) {
        const base = (manifest.baseUrl || "").replace(/\/$/, "");
        if (page <= 1) return base + basePath;
        return base + basePath.replace(/\.html$/, "") + "/" + page + ".html";
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 4 · getHome
    //             Mirrors Kotlin getMainPage()
    // ─────────────────────────────────────────────────────────────────────

    /**
     * getHome(cb)
     *
     * Fetches the first page of every category from the CATEGORIES list and
     * returns them keyed by category name.
     *
     * SkyStream automatically promotes the "Trending" key to the Hero Carousel;
     * every other key becomes a horizontal thumbnail row.
     */
    async function getHome(cb) {
        try {
            const homeData = {};

            for (const cat of CATEGORIES) {
                try {
                    const url = buildPaginatedUrl(cat.path, 1);
                    const res = await http_get(url, BASE_HEADERS);
                    if (res.status !== 200) continue;

                    const items = parseMovieLinks(res.body, new Set());
                    if (items.length > 0) {
                        homeData[cat.name] = items;
                    }
                } catch (e) {
                    // Non-fatal: skip failed category, keep the rest
                    console.error("[Moviezwap] getHome category failed [" +
                                  cat.name + "]: " + e.message);
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 5 · search
    //             Mirrors Kotlin search()
    // ─────────────────────────────────────────────────────────────────────

    /**
     * search(query, cb)
     *
     * Kotlin: val fixedQuery = query.replace(" ", "+")
     *         val searchUrl  = "$mainUrl/search.php?q=$fixedQuery"
     *         document.select("a[href*='/movie/']").mapNotNull { toSearchResult() }
     */
    async function search(query, cb) {
        try {
            const fixedQuery = query.trim().replace(/\s+/g, "+");
            const searchUrl  = (manifest.baseUrl || "").replace(/\/$/, "") +
                               "/search.php?q=" + encodeURIComponent(fixedQuery);

            const res = await http_get(searchUrl, BASE_HEADERS);
            if (res.status !== 200) return cb({ success: true, data: [] });

            const items = parseMovieLinks(res.body, new Set());
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 6 · load
    //             Mirrors Kotlin load()
    // ─────────────────────────────────────────────────────────────────────

    /**
     * load(url, cb)
     *
     * Full detail-page scraper. Produces a MultimediaItem with:
     *   - title   (h2 > title tag fallback)
     *   - poster  (img[src*='/poster/'] > og:image fallback)
     *   - description (td after "Desc/Plot" > first <p> fallback)
     *   - year    (td after "Release Date" or "Category")
     *
     * Series branch: extracts episodes from div.catList a[href*='/movie/']
     *                and creates one Episode per link.
     * Movie branch:  creates a single Episode with the movie URL so that
     *                loadStreams can scrape download links on demand.
     */
    async function load(url, cb) {
        try {
            const res = await http_get(url, BASE_HEADERS);
            if (res.status !== 200) {
                return cb({ success: false, errorCode: "SITE_OFFLINE" });
            }

            const html = res.body;

            // ── Title ──────────────────────────────────────────────────
            // Kotlin: document.selectFirst("h2")?.text()
            //      ?: document.selectFirst("title")?.text()
            //                  ?.substringBefore("-")
            let title = null;

            const h2M = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
            if (h2M) title = decodeHtml(h2M[1]);

            if (!title || title.length < 2) {
                const titleTagM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
                if (titleTagM) title = decodeHtml(titleTagM[1]).split("-")[0].trim();
            }

            if (!title || title.length < 2) {
                return cb({
                    success: false,
                    errorCode: "PARSE_ERROR",
                    message: "Could not extract title from page"
                });
            }

            // ── Poster ────────────────────────────────────────────────
            // Kotlin: document.selectFirst("img[src*='/poster/']")?.attr("src")
            let poster = "";

            const posterM = /<img[^>]+src="([^"]*\/poster\/[^"]*)"[^>]*>/i.exec(html);
            if (posterM) {
                poster = fixUrl(posterM[1]);
            } else {
                // Fallback: og:image meta tag
                const ogM = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
                if (ogM) poster = ogM[1];
            }

            // ── Description ───────────────────────────────────────────
            // Kotlin: document.select("td:contains(Desc/Plot) + td").text()
            let description = "";

            const descM = /<td[^>]*>[^<]*(?:Desc\/Plot|Description|Plot)[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
            if (descM) {
                description = decodeHtml(descM[1]);
            } else {
                // Fallback: first <p> with meaningful content
                const pM = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
                if (pM) description = decodeHtml(pM[1]);
            }

            // ── Year ──────────────────────────────────────────────────
            // Kotlin: document.select("td:contains(Release Date) + td").text()
            //      .ifEmpty { document.select("td:contains(Category) + td").text() }
            let year = null;

            const rdM  = /<td[^>]*>[^<]*Release\s+Date[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
            const catM = /<td[^>]*>[^<]*Category[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);

            const yearSrc = rdM  ? rdM[1].replace(/<[^>]*>/g, "")
                          : catM ? catM[1].replace(/<[^>]*>/g, "") : "";
            const yearM = /(\d{4})/.exec(yearSrc);
            if (yearM) year = parseInt(yearM[1]);

            // ── Series vs Movie detection ─────────────────────────────
            const seriesFlag = isSeries(title);

            // ── Series branch ─────────────────────────────────────────
            // Kotlin: val seasonLinks = document.select("div.catList a[href*='/movie/']")
            //         if (isSeries && seasonLinks.isNotEmpty()) { … }
            if (seriesFlag) {
                // Scope to div.catList if present; otherwise fall back to full page
                const catListM = /<div[^>]*class="[^"]*catList[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
                const searchScope = catListM ? catListM[1] : html;

                const episodes = [];
                const epRe = /<a\s[^>]*href="([^"]*\/movie\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
                let ep;
                let epIndex = 0;

                while ((ep = epRe.exec(searchScope)) !== null) {
                    const epHref  = ep[1].trim();
                    const epLabel = decodeHtml(ep[2]) || ("Episode " + (epIndex + 1));
                    const epUrl   = fixUrl(epHref);

                    // Kotlin: Regex("""Season\s*(\d+)""").find(episodeTitle)
                    const snM = /Season\s*(\d+)/i.exec(epLabel);
                    // Kotlin: Regex("""Eps?\s*\(?(\d+)""").find(episodeTitle)
                    const enM = /Eps?\s*\(?(\d+)/i.exec(epLabel);

                    const season  = snM ? parseInt(snM[1]) : 1;
                    const epNum   = enM ? parseInt(enM[1]) : epIndex + 1;

                    episodes.push(new Episode({
                        name:    epLabel,
                        url:     epUrl,  // episode page → scraped in loadStreams
                        season:  season,
                        episode: epNum,
                    }));

                    epIndex++;
                }

                if (episodes.length > 0) {
                    return cb({
                        success: true,
                        data: new MultimediaItem({
                            title:       title,
                            url:         url,
                            posterUrl:   poster,
                            type:        "series",
                            description: description || undefined,
                            year:        year || undefined,
                            episodes:    episodes,
                        })
                    });
                }
            }

            // ── Movie branch ──────────────────────────────────────────
            // Single Episode wrapping the movie URL; loadStreams scrapes
            // it on playback just as Kotlin loadLinks(data) does.
            cb({
                success: true,
                data: new MultimediaItem({
                    title:       title,
                    url:         url,
                    posterUrl:   poster,
                    type:        seriesFlag ? "series" : "movie",
                    description: description || undefined,
                    year:        year || undefined,
                    episodes: [
                        new Episode({
                            name:    "Full Movie",
                            url:     url,
                            season:  1,
                            episode: 1,
                        })
                    ],
                })
            });

        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 7 · loadStreams
    //             Mirrors Kotlin loadLinks()
    // ─────────────────────────────────────────────────────────────────────

    /**
     * loadStreams(url, cb)
     *
     * Receives the detail/episode page URL (set as Episode.url in load()).
     *
     * Kotlin pipeline:
     *  1. document.select("a[href*='dwload.php']")
     *             .map { href.replace("dwload.php", "download.php") }
     *  2. For each link → fetch download.php page
     *  3. downloadPage.selectFirst("a:contains(Fast Download Server)")?.attr("href")
     *     → that is the actual playable file link.
     *
     * Quality is read from the link label text (320p / 480p / 720p / 1080p).
     */
    async function loadStreams(url, cb) {
        try {
            const res = await http_get(url, BASE_HEADERS);
            if (res.status !== 200) return cb({ success: true, data: [] });

            const html     = res.body;
            const results  = [];
            const seenDl   = new Set();   // dedup download.php pages
            const seenFinal= new Set();   // dedup final stream URLs

            // ── Step 1: Find dwload.php links ─────────────────────────
            // Kotlin: document.select("a[href*='dwload.php']")
            const dwRe = /<a\s[^>]*href="([^"]*dwload\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            let m;

            while ((m = dwRe.exec(html)) !== null) {
                // Kotlin: it.attr("href").replace("dwload.php", "download.php")
                const dlPageUrl = fixUrl(m[1].replace("dwload.php", "download.php"));
                const linkLabel = decodeHtml(m[2]);

                if (seenDl.has(dlPageUrl)) continue;
                seenDl.add(dlPageUrl);

                const quality = getQuality(linkLabel);

                // ── Step 2: Fetch download.php page ───────────────────
                let actualUrl = null;
                try {
                    const dlRes = await http_get(dlPageUrl, {
                        ...BASE_HEADERS,
                        Referer: url,
                    });

                    if (dlRes.status === 200) {
                        const dlHtml = dlRes.body;

                        // Primary: "Fast Download Server" anchor
                        // Kotlin: downloadPage.selectFirst("a:contains(Fast Download Server)")
                        const fastM = /href="([^"]+)"[^>]*>[^<]*Fast\s+Download\s+Server[^<]*<\//i.exec(dlHtml);
                        if (fastM) actualUrl = fastM[1];

                        // Fallback A: direct video file link (.mp4 / .mkv / .m3u8)
                        if (!actualUrl) {
                            const vidM = /href="(https?:\/\/[^"]+\.(mp4|mkv|avi|m3u8)[^"]*)"/i.exec(dlHtml);
                            if (vidM) actualUrl = vidM[1];
                        }

                        // Fallback B: any external http link on the download page
                        if (!actualUrl) {
                            const anyM = /href="(https?:\/\/(?!(?:www\.)?moviezwap)[^"]+)"/i.exec(dlHtml);
                            if (anyM) actualUrl = anyM[1];
                        }
                    }
                } catch (dlErr) {
                    console.error("[Moviezwap] download.php fetch failed: " + dlErr.message);
                }

                // Fallback C: use the download.php URL itself when page scraping fails
                if (!actualUrl) actualUrl = dlPageUrl;

                if (!actualUrl || seenFinal.has(actualUrl)) continue;
                seenFinal.add(actualUrl);

                results.push(new StreamResult({
                    url:     actualUrl,
                    quality: quality,
                    headers: {
                        "User-Agent": UA,
                        "Referer":    dlPageUrl,
                    },
                }));
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 8 · EXPORT  (required by SkyStream runtime)
    // ─────────────────────────────────────────────────────────────────────

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
