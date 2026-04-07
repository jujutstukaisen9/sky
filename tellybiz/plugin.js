(function() {
    const BASE_URL = manifest.baseUrl || "https://tellybiz.in";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
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
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, " ");
    }

    function cleanTitle(raw) {
        if (!raw) return "Unknown";
        return decodeHtml(String(raw))
            .replace(/\b(480p|720p|1080p|4K|HDRip|BluRay|WEBRip|WEB-DL|DVDRip|HEVC|x264|x265|AAC|DD5\.1|ESub|ESubs|Telugu|Hindi|English|Movie|Film)\b/gi, "")
            .replace(/[_\-]+/g, " ").replace(/\s{2,}/g, " ").trim();
    }

    function getQuality(text) {
        if (!text) return 0;
        const t = String(text).toLowerCase();
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
            if (!res || !res.body) return cb({ success: false, errorCode: "HOME_ERROR", message: "Failed to fetch" });

            const html = res.body;
            const items = [];
            const seen = new Set();

            const pattern = /<a[^>]+href=["']([^"']*loanid\.php\?lid=[^"']+)["']/gi;
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const href = match[1];
                if (seen.has(href)) continue;
                seen.add(href);

                const ctx = html.substring(Math.max(0, match.index - 600), Math.min(html.length, match.index + 600));
                const imgM = ctx.match(/<img[^>]+src=["']([^"']+)["']/i);
                const titleM = ctx.match(/<(?:h[1-6]|span)[^>]*class=["'][^"']*movie-title[^"']*["'][^>]*>([^<]+)</i);

                let title = titleM ? cleanTitle(titleM[1]) : "";
                let poster = imgM ? fixUrl(imgM[1], BASE_URL) : "";
                if (!title) {
                    const altM = ctx.match(/alt=["']([^"']+)["']/i);
                    title = cleanTitle(altM ? altM[1] : "");
                }
                if (!title) {
                    const lidM = href.match(/lid=([^&]+)/);
                    if (lidM) try { title = cleanTitle(atob(lidM[1])); } catch(e) {}
                }
                if (!title) title = "Movie " + items.length;

                items.push(new MultimediaItem({ title, url: fixUrl(href, BASE_URL), posterUrl: poster, type: "movie" }));
            }

            cb({ success: true, data: { "Trending": items.slice(0, 24), "Latest": items.slice(24, 48), "All Movies": items } });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await http_get(BASE_URL + "/?q=" + encodeURIComponent(query), { headers: HEADERS });
            if (!res || !res.body) return cb({ success: true, data: [] });

            const html = res.body;
            const items = [];
            const seen = new Set();
            const pattern = /<a[^>]+href=["']([^"']*loanid\.php\?lid=[^"']+)["']/gi;
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const href = match[1];
                if (seen.has(href)) continue;
                seen.add(href);
                const ctx = html.substring(Math.max(0, match.index - 300), Math.min(html.length, match.index + 300));
                const imgM = ctx.match(/<img[^>]+src=["']([^"']+)["']/i);
                const titleM = ctx.match(/alt=["']([^"']+)["']/i);
                let title = titleM ? cleanTitle(titleM[1]) : "";
                const poster = imgM ? fixUrl(imgM[1], BASE_URL) : "";
                if (!title) {
                    const lidM = href.match(/lid=([^&]+)/);
                    if (lidM) try { title = cleanTitle(atob(lidM[1])); } catch(e) {}
                }
                if (title && title.toLowerCase().includes(query.toLowerCase())) {
                    items.push(new MultimediaItem({ title, url: fixUrl(href, BASE_URL), posterUrl: poster, type: "movie" }));
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
            if (!res || !res.body) return cb({ success: false, errorCode: "LOAD_ERROR" });

            const html = res.body;
            let title = "Unknown", poster = "", description = "", year, score;
            const cast = [], qualityOptions = [];

            const tM = html.match(/<h1[^>]+class=["'][^"']*movie-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
            if (tM) title = cleanTitle(tM[1]);
            const pM = html.match(/<img[^>]+class=["'][^"']*poster[^"']*["'][^>]+src=["']([^"']+)["']/i);
            if (pM) poster = fixUrl(pM[1], BASE_URL);
            if (!poster) {
                const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i);
                if (og) poster = og[1];
            }
            const ovM = html.match(/<p[^>]+class=["'][^"']*overview[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
            if (ovM) description = decodeHtml(ovM[1].replace(/<[^>]+>/g, "").trim());
            const yM = html.match(/📅\s*(\d{4})/);
            if (yM) year = parseInt(yM[1]);
            const rM = html.match(/★\s*([\d.]+)\/10/);
            if (rM) score = parseFloat(rM[1]);

            for (const m of html.matchAll(/<span[^>]+class=["'][^"']*cast-item[^"']*["'][^>]*>([^<]+)<\/span>/gi)) {
                const name = decodeHtml(m[1].trim());
                if (name) cast.push(new Actor({ name }));
            }

            for (const m of html.matchAll(/<a[^>]+class=["'][^"']*file-item[^"']*["'][^>]+data-href=["']([^"']*loanagreement\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
                const fnM = m[2].match(/class=["'][^"']*file-name["'][^>]*>([^<]+)</i);
                const fsM = m[2].match(/class=["'][^"']*file-size["'][^>]*>([^<]+)</i);
                const fileName = fnM ? decodeHtml(fnM[1].trim()) : "Video";
                const fileSize = fsM ? decodeHtml(fsM[1].trim()) : "";
                qualityOptions.push({ url: fixUrl(m[1], BASE_URL), quality: getQuality(fileName), label: fileName + (fileSize ? ` (${fileSize})` : "") });
            }

            cb({ success: true, data: new MultimediaItem({
                title, url, posterUrl: poster, description, year, score, type: "movie", cast,
                episodes: [new Episode({ name: title, url: JSON.stringify({ loanUrl: url, qualityOptions }), season: 1, episode: 1 })]
            })});
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const { qualityOptions } = JSON.parse(dataStr);
            const results = [], seen = new Set();
            for (const opt of (qualityOptions || [])) {
                try {
                    const res = await http_get(opt.url, { headers: HEADERS });
                    if (!res || !res.body) continue;
                    const cdnM = res.body.match(/href=["'](https?:\/\/cdn\.cdngo\.site\/[^"']+\.(?:mkv|mp4|avi|mov|webm)[^"']*)["']/i);
                    if (cdnM && !seen.has(cdnM[1])) {
                        seen.add(cdnM[1]);
                        results.push(new StreamResult({ url: cdnM[1], quality: opt.quality || getQuality(cdnM[1]), source: `TellyBiz - ${opt.label}`, headers: { "Referer": BASE_URL + "/" } }));
                    }
                } catch (e) {}
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
