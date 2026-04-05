(function() {
    /**
     * Fibwatch Plugin for SkyStream
     * Fixed: LinkedHashSet error and stream extraction
     */

    const headers = { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
    };

    const getBaseUrl = () => {
        if (typeof manifest !== 'undefined' && manifest.baseUrl) return manifest.baseUrl;
        return "https://fibwatch.biz";
    };

    function safeParse(data) {
        if (!data) return null;
        if (typeof data === 'object') return data;
        try { return JSON.parse(data); } catch (e) { return null; }
    }

    function cleanTitle(raw) {
        if (!raw) return "Unknown";
        const regex = /S(\d+)[Ee](\d+)(?:-(\d+))?/;
        const match = raw.match(regex);
        if (!match) return raw.trim();
        
        const season = match[1];
        const epStart = match[2];
        const epEnd = match[3];
        const showName = raw.substring(0, raw.indexOf(match[0])).trim();
        
        const episodes = epEnd ? `Episodes ${epStart}–${epEnd}` : `Episode ${epStart}`;
        return `${showName} Season ${season} | ${episodes}`;
    }

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        const base = getBaseUrl();
        if (url.startsWith("/")) return `${base}${url}`;
        return `${base}/${url}`;
    }

    function parseSeasonEpisode(title) {
        const t = title.toLowerCase();
        const fullMatch = t.match(/s(\d{1,2})e(\d{1,3})(?:-(\d{1,3}))?/);
        if (fullMatch) {
            return {
                season: parseInt(fullMatch[1]),
                episode: parseInt(fullMatch[2]),
                episodeEnd: fullMatch[3] ? parseInt(fullMatch[3]) : null
            };
        }
        const seasonMatch = t.match(/\bs(\d{1,2})\b/);
        if (seasonMatch) return { season: parseInt(seasonMatch[1]), episode: null };
        const epMatch = t.match(/\be(\d{1,3})\b/);
        if (epMatch) return { season: null, episode: parseInt(epMatch[1]) };
        return { season: 1, episode: 1 };
    }

    function determineType(title) {
        const t = title.toLowerCase();
        if (/s\d{1,2}e\d{1,3}/.test(t) || /\bs\d{1,2}\b/.test(t) || /\be\d{1,3}\b/.test(t)) return "series";
        return "movie";
    }

    function extractVideoThumb(element) {
        const linkEl = element.querySelector('a');
        const imgEl = element.querySelector('img');
        const titleEl = element.querySelector('p.hptag') || imgEl;
        
        if (!linkEl) return null;
        
        const href = fixUrl(linkEl.getAttribute('href'));
        const title = cleanTitle(titleEl?.textContent || imgEl?.getAttribute('alt') || 'Unknown');
        const posterUrl = fixUrl(imgEl?.getAttribute('src') || '');
        
        const type = determineType(title);
        
        return new MultimediaItem({
            title: title,
            url: JSON.stringify({ url: href, poster: posterUrl, type: type }),
            posterUrl: posterUrl,
            type: type,
            contentType: type
        });
    }

    async function getHome(cb) {
        try {
            const categories = [
                { path: "/videos/trending", name: "Trending Videos" },
                { path: "/videos/top", name: "Top Videos" },
                { path: "/videos/latest", name: "Latest Videos" },
                { path: "/videos/category/1", name: "Bangla–Kolkata Movies" },
                { path: "/videos/category/852", name: "Bangla Dubbed" },
                { path: "/videos/category/3", name: "Web Series" },
                { path: "/videos/category/4", name: "Hindi Movies" },
                { path: "/videos/category/5", name: "Hindi Dubbed Movies" },
                { path: "/videos/category/9", name: "Horror Movies" },
                { path: "/videos/category/6", name: "Tamil & Telugu Movies" },
                { path: "/videos/category/11", name: "Kannada Movies" },
                { path: "/videos/category/10", name: "Malayalam Movies" },
                { path: "/videos/category/8", name: "English Movies" },
                { path: "/videos/category/12", name: "Korean Movies" },
                { path: "/videos/category/13", name: "Marathi Movies" },
                { path: "/videos/category/7", name: "Cartoon Movies" },
                { path: "/videos/category/853", name: "Mixed Content" },
                { path: "/videos/category/854", name: "TV Shows" },
                { path: "/videos/category/855", name: "Natok" },
                { path: "/videos/category/other", name: "Other" }
            ];

            const results = await Promise.all(categories.map(async (cat) => {
                try {
                    const url = `${getBaseUrl()}${cat.path}`;
                    const res = await http_get(url, headers);
                    if (!res || !res.body) return null;

                    const doc = await parseHtml(res.body);
                    const items = Array.from(doc.querySelectorAll('div.video-thumb'))
                        .map(el => extractVideoThumb(el))
                        .filter(item => item !== null);

                    const seen = new Set();
                    const uniqueItems = items.filter(item => {
                        if (seen.has(item.url)) return false;
                        seen.add(item.url);
                        return true;
                    });

                    if (uniqueItems.length > 0) return { name: cat.name, items: uniqueItems };
                } catch (e) {
                    console.error(`Error fetching ${cat.name}: ${e.message}`);
                }
                return null;
            }));

            const finalResult = {};
            results.filter(Boolean).forEach(res => {
                finalResult[res.name] = res.items;
            });

            cb({ success: true, data: finalResult });
        } catch (e) {
            console.error("Critical getHome Error:", e);
            cb({ success: false, errorCode: "HTTP_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const url = `${getBaseUrl()}/search?keyword=${encodeURIComponent(query)}`;
            const res = await http_get(url, headers);
            const doc = await parseHtml(res.body);
            
            const items = Array.from(doc.querySelectorAll('div.video-thumb'))
                .map(el => extractVideoThumb(el))
                .filter(item => item !== null);

            const seen = new Set();
            const uniqueItems = items.filter(item => {
                if (seen.has(item.url)) return false;
                seen.add(item.url);
                return true;
            });

            cb({ success: true, data: uniqueItems });
        } catch (e) {
            console.error("Search Error:", e);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(urlStr, cb) {
        try {
            const media = safeParse(urlStr);
            if (!media) throw new Error("Invalid URL data");
            
            const res = await http_get(media.url, headers);
            const doc = await parseHtml(res.body);

            const rawTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || 'Unknown';
            const title = cleanTitle(rawTitle.split('S0')[0]);
            const poster = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || media.poster;
            const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            const tags = Array.from(doc.querySelectorAll("div.tags-list a[rel='tag']")).map(a => a.textContent).filter(Boolean);
            
            const recommendations = Array.from(doc.querySelectorAll('div.col-md-4.no-padding-left.mobile div.videos-list.pt_mn_wtch_rlts_prnt .video-wrapper'))
                .map(el => extractVideoThumb(el)).filter(Boolean);

            const videoId = doc.querySelector('input#video-id')?.getAttribute('value');
            const type = determineType(rawTitle);

            // Helper to create load item
            const toLoadItem = (res, url, selected) => ({
                quality: (res || '').trim(),
                url: (url || '').trim(),
                selected: selected || false
            });

            // FIXED: Use regular Set instead of LinkedHashSet
            const dedupeByUrl = (list) => {
                const seen = new Set();
                return list.filter(item => {
                    if (seen.has(item.url)) return false;
                    seen.add(item.url);
                    return true;
                });
            };

            // Fetch links from API
            let linksData = null;
            if (videoId) {
                try {
                    const linksRes = await http_get(`${getBaseUrl()}/ajax/resolution_switcher.php?video_id=${videoId}`, headers);
                    linksData = safeParse(linksRes.body);
                } catch (e) {
                    console.error("Failed to fetch resolution switcher:", e);
                }
            }

            const currentList = dedupeByUrl((linksData?.current || [])
                .filter(c => c.url && c.url.trim())
                .map(c => toLoadItem(c.res, c.url, c.selected)));

            const popupList = dedupeByUrl((linksData?.popup || [])
                .filter(p => p.url && p.url.trim() && !currentList.some(c => c.url === p.url))
                .map(p => toLoadItem(p.res, p.url, p.selected)));

            let linksOut = {
                status: linksData?.status || 'error',
                current: currentList,
                popup: popupList
            };

            // Fallback to download button
            if (currentList.length === 0 && popupList.length === 0) {
                try {
                    const downloadEl = doc.querySelector('a.hidden-button.buttonDownloadnew');
                    const onclick = downloadEl?.getAttribute('onclick') || '';
                    const urlMatch = onclick.match(/url=['"]([^'"]+)['"]/);
                    
                    if (urlMatch) {
                        linksOut = {
                            status: 'success',
                            current: [{ quality: 'Auto', url: urlMatch[1].trim(), selected: false }],
                            popup: []
                        };
                    }
                } catch (e) {}
            }

            if (type === 'series' && videoId) {
                // Fetch episodes
                let episodes = [];
                try {
                    const epRes = await http_get(`${getBaseUrl()}/ajax/episodes.php?video_id=${videoId}`, headers);
                    const epData = safeParse(epRes.body);

                    if (epData?.episodes && epData.episodes.length > 0) {
                        // Process episodes with limited concurrency
                        for (const ep of epData.episodes) {
                            try {
                                const epUrl = ep.url?.trim();
                                if (!epUrl) continue;
                                
                                const epTitle = ep.title?.trim() || 'Episode';
                                const parsed = parseSeasonEpisode(epTitle);
                                
                                // Fetch episode page for links
                                let epLinksOut = { status: 'error', current: [], popup: [] };
                                try {
                                    const epPageRes = await http_get(fixUrl(epUrl), headers);
                                    const epDoc = await parseHtml(epPageRes.body);
                                    const innerVideoId = epDoc.querySelector('input#video-id')?.getAttribute('value');
                                    
                                    if (innerVideoId) {
                                        const innerLinksRes = await http_get(`${getBaseUrl()}/ajax/resolution_switcher.php?video_id=${innerVideoId}`, headers);
                                        const innerLinks = safeParse(innerLinksRes.body);
                                        
                                        const innerCurrent = (innerLinks?.current || [])
                                            .filter(c => c.url)
                                            .map(c => toLoadItem(c.res, c.url, c.selected));
                                        const innerPopup = (innerLinks?.popup || [])
                                            .filter(p => p.url && !innerCurrent.some(c => c.url === p.url))
                                            .map(p => toLoadItem(p.res, p.url, p.selected));
                                        
                                        epLinksOut = {
                                            status: innerLinks?.status || 'error',
                                            current: innerCurrent,
                                            popup: innerPopup
                                        };
                                        
                                        // Fallback for episode
                                        if (innerCurrent.length === 0 && innerPopup.length === 0) {
                                            const dlEl = epDoc.querySelector('a.hidden-button.buttonDownloadnew');
                                            const onclick = dlEl?.getAttribute('onclick') || '';
                                            const match = onclick.match(/url=['"]([^'"]+)['"]/);
                                            if (match) {
                                                epLinksOut.current = [{ quality: 'Auto', url: match[1], selected: false }];
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.error("Error fetching episode details:", e);
                                }

                                episodes.push(new Episode({
                                    name: epTitle,
                                    url: JSON.stringify(epLinksOut),
                                    season: parsed.season || 1,
                                    episode: parsed.episode || 1,
                                    posterUrl: poster
                                }));
                            } catch (e) {
                                console.error("Error processing episode:", e);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch episodes:", e);
                }

                if (episodes.length === 0) {
                    episodes = [new Episode({
                        name: title,
                        url: JSON.stringify(linksOut),
                        season: 1,
                        episode: 1,
                        posterUrl: poster
                    })];
                }

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: urlStr,
                        posterUrl: poster,
                        description: description,
                        type: 'series',
                        tags: tags,
                        recommendations: recommendations,
                        episodes: episodes
                    })
                });
            } else {
                // Movie
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: JSON.stringify(linksOut),
                        posterUrl: poster,
                        description: description,
                        type: 'movie',
                        tags: tags,
                        recommendations: recommendations
                    })
                });
            }
        } catch (e) {
            console.error("Load Error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const loadData = safeParse(dataStr);
            if (!loadData) throw new Error("Invalid load data");

            const streams = [];
            const seenUrls = new Set();

            // Combine current and popup
            const currentUrls = new Set((loadData.current || []).map(i => i.url?.trim()));
            const combined = [
                ...(loadData.current || []),
                ...(loadData.popup || []).filter(p => !currentUrls.has(p.url?.trim()))
            ];

            for (const item of combined) {
                const url = item.url?.trim();
                if (!url || seenUrls.has(url)) continue;
                seenUrls.add(url);

                const quality = item.quality || 'Auto';

                // Check if direct media
                const isDirect = /\.(mkv|mp4|m3u8)(\?.*)?$/i.test(url);

                let finalUrl = url;

                if (!isDirect) {
                    // Resolve download page
                    try {
                        const docRes = await http_get(fixUrl(url), headers);
                        const doc = await parseHtml(docRes.body);
                        
                        // Try multiple selectors for download link
                        const downloadEl = doc.querySelector('a.hidden-button.buttonDownloadnew') ||
                                         doc.querySelector('a[href*="download"]') ||
                                         doc.querySelector('.download-link a');
                                         
                        if (downloadEl) {
                            const href = downloadEl.getAttribute('href');
                            const onclick = downloadEl.getAttribute('onclick') || '';
                            
                            // Extract URL from onclick or href
                            const onclickMatch = onclick.match(/url=['"]([^'"]+)['"]/) ||
                                               onclick.match(/window\.open\(['"]([^'"]+)['"]/) ||
                                               href?.match(/(https?:\/\/[^\s'"]+)/);
                            
                            if (onclickMatch) {
                                finalUrl = onclickMatch[1];
                            } else if (href && href.startsWith('http')) {
                                finalUrl = href;
                            }
                        }
                        
                        // Also check for direct video in page
                        const videoMatch = docRes.body.match(/(https?:\/\/[^\s"']+\.(mp4|mkv|m3u8))/);
                        if (videoMatch && !finalUrl.startsWith('http')) {
                            finalUrl = videoMatch[1];
                        }
                    } catch (e) {
                        console.error("Failed to resolve URL:", url, e);
                        continue;
                    }
                }

                if (finalUrl && finalUrl.startsWith('http')) {
                    streams.push(new StreamResult({
                        url: finalUrl,
                        quality: quality,
                        source: `Fibwatch${quality !== 'Auto' ? ' [' + quality + ']' : ''}`,
                        headers: {
                            "Referer": getBaseUrl(),
                            "User-Agent": headers["User-Agent"]
                        }
                    }));
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            console.error("LoadStreams Error:", e);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
