(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const BASE_URL = manifest.baseUrl || "https://tellybiz.in";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
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
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, " ");
    }

    function cleanTitle(raw) {
        if (!raw) return "Unknown";
        return decodeHtml(String(raw))
            .replace(/\b(480p|720p|1080p|4K|HDRip|BluRay|WEBRip|WEB-DL|DVDRip|HEVC|x264|x265|AAC|DD5\.1|ESub|ESubs|Telugu|Hindi|English)\b/gi, "")
            .replace(/[_\-]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    function getQuality(text) {
        if (!text) return "Auto";
        const t = String(text).toLowerCase();
        if (t.includes("2160") || t.includes("4k")) return "2160p";
        if (t.includes("1080")) return "1080p";
        if (t.includes("720")) return "720p";
        if (t.includes("480")) return "480p";
        if (t.includes("360")) return "360p";
        return "Auto";
    }

    function getQualityInt(text) {
        const t = String(text || "").toLowerCase();
        if (t.includes("2160") || t.includes("4k")) return 2160;
        if (t.includes("1080")) return 1080;
        if (t.includes("720")) return 720;
        if (t.includes("480")) return 480;
        if (t.includes("360")) return 360;
        return 0;
    }

    async function getHome(cb) {
        try {
            const res = await http_get(BASE_URL + "/", { headers: HEADERS });
            
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "Failed to fetch home page" });
            }

            const html = res.body;
            const items = [];
            const seen = new Set();

            const posterPattern = /<a[^>]+href=["']([^"']*loanid\.php[^"']*)["'][^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
            let match;
            
            while ((match = posterPattern.exec(html)) !== null) {
                const href = match[1];
                const imgSrc = match[2];
                
                if (seen.has(href)) continue;
                seen.add(href);
                
                const titleMatch = html.substring(html.indexOf(href), html.indexOf(href) + 500).match(/<(?:h[1-6]|p|span)[^>]*>([^<]+)</i);
                let title = "Unknown";
                if (titleMatch) {
                    title = cleanTitle(titleMatch[1]);
                } else {
                    const lidMatch = href.match(/lid=([^&]+)/);
                    if (lidMatch) {
                        try {
                            const decoded = atob(lidMatch[1]);
                            title = cleanTitle(decoded);
                        } catch (e) {
                            title = "Movie " + items.length;
                        }
                    }
                }
                
                items.push(new MultimediaItem({
                    title,
                    url: fixUrl(href, BASE_URL),
                    posterUrl: fixUrl(imgSrc, BASE_URL),
                    type: "movie"
                }));
            }

            if (items.length === 0) {
                const linkOnlyPattern = /<a[^>]+href=["']([^"']*loanid\.php[^"']*)["'][^>]*class=["'][^"']*(?:poster|thumb|movie|film|card)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
                while ((match = linkOnlyPattern.exec(html)) !== null) {
                    const href = match[1];
                    
                    if (seen.has(href)) continue;
                    seen.add(href);
                    
                    const lidMatch = href.match(/lid=([^&]+)/);
                    let title = "Movie " + (items.length + 1);
                    if (lidMatch) {
                        try {
                            const decoded = atob(lidMatch[1]);
                            title = cleanTitle(decoded);
                        } catch (e) {}
                    }
                    
                    items.push(new MultimediaItem({
                        title,
                        url: fixUrl(href, BASE_URL),
                        posterUrl: "",
                        type: "movie"
                    }));
                }
            }

            cb({ 
                success: true, 
                data: {
                    "Trending": items.slice(0, 24),
                    "Latest": items.slice(24, 48),
                    "All Movies": items
                }
            });

        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(BASE_URL + "/search.php?q=" + encodeURIComponent(query), { headers: HEADERS });
            
            if (!res || !res.body) {
                return cb({ success: true, data: [] });
            }

            const html = res.body;
            const items = [];
            const seen = new Set();

            const posterPattern = /<a[^>]+href=["']([^"']*loanid\.php[^"']*)["'][^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
            let match;
            
            while ((match = posterPattern.exec(html)) !== null) {
                const href = match[1];
                const imgSrc = match[2];
                
                if (seen.has(href)) continue;
                seen.add(href);
                
                const lidMatch = href.match(/lid=([^&]+)/);
                let title = "Movie";
                if (lidMatch) {
                    try {
                        const decoded = atob(lidMatch[1]);
                        title = cleanTitle(decoded);
                    } catch (e) {}
                }
                
                if (title.toLowerCase().includes(query.toLowerCase())) {
                    items.push(new MultimediaItem({
                        title,
                        url: fixUrl(href, BASE_URL),
                        posterUrl: fixUrl(imgSrc, BASE_URL),
                        type: "movie"
                    }));
                }
            }

            cb({ success: true, data: items });

        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, { headers: HEADERS });
            
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to fetch movie page" });
            }

            const html = res.body;
            let title = "Unknown";
            let poster = "";

            const lidMatch = url.match(/lid=([^&]+)/);
            if (lidMatch) {
                try {
                    const decoded = atob(lidMatch[1]);
                    title = cleanTitle(decoded);
                } catch (e) {}
            }

            const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<h2[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)<\/h2>/i);
            if (titleMatch) {
                title = cleanTitle(titleMatch[1]);
            }

            const ogImage = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i);
            if (ogImage) {
                poster = ogImage[1];
            }

            const qualityOptions = [];
            const qualityPattern = /<a[^>]+href=["']([^"']*loanagreement\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            
            while ((match = qualityPattern.exec(html)) !== null) {
                const href = match[1];
                const text = decodeHtml(match[2].replace(/<[^>]+>/g, "").trim());
                const quality = getQuality(text);
                
                qualityOptions.push({
                    url: fixUrl(href, BASE_URL),
                    quality: quality,
                    label: text || quality
                });
            }

            if (qualityOptions.length === 0) {
                const selectMatch = html.match(/<select[^>]*>([\s\S]*?)<\/select>/i);
                if (selectMatch) {
                    const options = selectMatch[1].match(/<option[^>]+value=["']([^"']*loanagreement\.php[^"']*)["'][^>]*>([^<]+)/gi);
                    if (options) {
                        for (const opt of options) {
                            const optMatch = opt.match(/value=["']([^"']+)["'][^>]*>([^<]+)/);
                            if (optMatch) {
                                qualityOptions.push({
                                    url: fixUrl(optMatch[1], BASE_URL),
                                    quality: getQuality(optMatch[2]),
                                    label: optMatch[2].trim()
                                });
                            }
                        }
                    }
                }
            }

            const streamsPayload = JSON.stringify({
                loanUrl: url,
                qualityOptions: qualityOptions
            });

            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url,
                    posterUrl: poster,
                    type: "movie",
                    episodes: [
                        new Episode({
                            name: title,
                            url: streamsPayload,
                            season: 1,
                            episode: 1
                        })
                    ]
                })
            });

        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const payload = JSON.parse(dataStr);
            const qualityOptions = payload.qualityOptions || [];
            const results = [];
            const seen = new Set();

            for (const option of qualityOptions) {
                try {
                    const res = await http_get(option.url, { headers: HEADERS });
                    
                    if (!res || !res.body) continue;
                    
                    const html = res.body;

                    const cdnPattern = /https?:\/\/cdn\.cdngo\.site\/[^\s"'<>\)]+\.(mkv|mp4|avi|mov|webm)[^\s"'<>\)]*/gi;
                    let match;
                    while ((match = cdnPattern.exec(html)) !== null) {
                        const url = match[0];
                        if (!seen.has(url)) {
                            seen.add(url);
                            const qualityInt = getQualityInt(option.quality);
                            
                            results.push(new StreamResult({
                                url: url,
                                quality: qualityInt || undefined,
                                source: `TellyBiz ${option.label}`,
                                headers: { "Referer": BASE_URL + "/" }
                            }));
                        }
                    }

                    const directPattern = /https?:\/\/[^\s"'<>\)]+\.(mkv|mp4)[^\s"'<>\)]*/gi;
                    while ((match = directPattern.exec(html)) !== null) {
                        const url = match[0];
                        if (!seen.has(url) && !url.includes("cdngo.site")) {
                            seen.add(url);
                            const qualityInt = getQualityInt(url) || getQualityInt(option.quality);
                            
                            results.push(new StreamResult({
                                url: url,
                                quality: qualityInt || undefined,
                                source: `Direct ${option.label}`,
                                headers: { "Referer": option.url }
                            }));
                        }
                    }

                    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                    if (iframeMatch) {
                        const iframeUrl = fixUrl(iframeMatch[1], BASE_URL);
                        if (iframeUrl.startsWith("http") && !seen.has(iframeUrl)) {
                            seen.add(iframeUrl);
                            results.push(new StreamResult({
                                url: iframeUrl,
                                quality: getQualityInt(option.quality) || undefined,
                                source: `Embed ${option.label}`,
                                headers: { "Referer": option.url }
                            }));
                        }
                    }

                } catch (e) {
                    console.error(`Error processing ${option.label}: ${e.message}`);
                }
            }

            results.sort((a, b) => (b.quality || 0) - (a.quality || 0));
            cb({ success: true, data: results });

        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
