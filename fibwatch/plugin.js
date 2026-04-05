(function() {
    /**
     * SkyStream Plugin: Fibwatch Suite
     * Source: CloudStream Fibwatch Extension
     * Migrated by: Principal Engineer
     * 
     * Supports: fibwatch.biz (Movies/Series), fibtoon.top (Anime), fibwatchdrama.xyz (Asian Drama)
     */
    
    // ==================== CONFIGURATION ====================
    
    const CONFIG = {
        // Variant detection based on manifest.packageName or baseUrl
        variants: {
            fibwatch: {
                name: "FibWatch",
                baseUrl: "https://fibwatch.biz",
                type: "mixed", // movies + series
                categories: [
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
                ]
            },
            fibtoon: {
                name: "FibToon",
                baseUrl: "https://fibtoon.top",
                type: "anime",
                categories: [
                    { path: "/videos/top", name: "Top Videos" },
                    { path: "/videos/latest", name: "Latest Videos" }
                ]
            },
            fibwatchdrama: {
                name: "FibWatch Drama",
                baseUrl: "https://fibwatchdrama.xyz",
                type: "drama",
                categories: [
                    { path: "/videos/top", name: "Top Videos" },
                    { path: "/videos/latest", name: "Latest Videos" }
                ]
            }
        },
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        }
    };

    // ==================== UTILITIES ====================
    
    function getVariant() {
        // Detect variant from manifest or default to fibwatch
        const baseUrl = (typeof manifest !== 'undefined' && manifest.baseUrl) 
            ? manifest.baseUrl 
            : "https://fibwatch.biz";
        
        if (baseUrl.includes("fibtoon")) return CONFIG.variants.fibtoon;
        if (baseUrl.includes("drama")) return CONFIG.variants.fibwatchdrama;
        return CONFIG.variants.fibwatch;
    }

    function getBaseUrl() {
        return (typeof manifest !== 'undefined' && manifest.baseUrl) 
            ? manifest.baseUrl 
            : getVariant().baseUrl;
    }

    function safeJsonParse(str) {
        if (!str) return null;
        if (typeof str === 'object') return str;
        try {
            return JSON.parse(str);
        } catch (e) {
            return null;
        }
    }

    function cleanTitle(raw) {
        if (!raw) return "Unknown";
        // Clean up S01E01 patterns
        const regex = /S(\d+)[Ee](\d+)(?:-(\d+))?/;
        const match = raw.match(regex);
        if (!match) return raw.trim();
        
        const season = match[1];
        const epStart = match[2];
        const epEnd = match[3];
        const showName = raw.substring(0, raw.indexOf(match[0])).trim();
        const yearMatch = raw.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : null;
        
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
        
        // Case: S01E05 or S1E5 or S01E05-08
        const fullMatch = t.match(/s(\d{1,2})e(\d{1,3})(?:-(\d{1,3}))?/);
        if (fullMatch) {
            return {
                season: parseInt(fullMatch[1]),
                episode: parseInt(fullMatch[2]),
                episodeEnd: fullMatch[3] ? parseInt(fullMatch[3]) : null
            };
        }
        
        // Case: S01 only
        const seasonMatch = t.match(/\bs(\d{1,2})\b/);
        if (seasonMatch) {
            return { season: parseInt(seasonMatch[1]), episode: null, episodeEnd: null };
        }
        
        // Case: E05 only
        const epMatch = t.match(/\be(\d{1,3})\b/);
        if (epMatch) {
            return { season: null, episode: parseInt(epMatch[1]), episodeEnd: null };
        }
        
        return { season: null, episode: null, episodeEnd: null };
    }

    function determineType(title) {
        const t = title.toLowerCase();
        const sxeRegex = /s\d{1,2}e\d{1,3}/;
        const seasonRegex = /\bs\d{1,2}\b/;
        const episodeRegex = /\be\d{1,3}\b/;
        
        if (sxeRegex.test(t) || seasonRegex.test(t) || episodeRegex.test(t)) {
            return "series";
        }
        return "movie";
    }

    // ==================== HTML PARSERS ====================
    
    function extractVideoThumb(element) {
        const linkEl = element.querySelector('a');
        const imgEl = element.querySelector('img');
        const titleEl = element.querySelector('p.hptag') || 
                       element.querySelector('div.video-thumb img');
        
        if (!linkEl) return null;
        
        const href = fixUrl(linkEl.getAttribute('href'));
        const title = cleanTitle(titleEl?.textContent || imgEl?.getAttribute('alt') || 'Unknown');
        const posterUrl = fixUrl(imgEl?.getAttribute('src') || '');
        
        return new MultimediaItem({
            title: title,
            url: href,
            posterUrl: posterUrl,
            type: determineType(title),
            contentType: determineType(title)
        });
    }

    // ==================== CORE FUNCTIONS ====================

    async function getHome(cb) {
        try {
            const variant = getVariant();
            const results = {};
            
            // Fetch all categories concurrently
            const fetchPromises = variant.categories.map(async (cat) => {
                try {
                    const url = `${getBaseUrl()}${cat.path}`;
                    const res = await http_get(url, CONFIG.headers);
                    
                    if (!res || !res.body) {
                        console.error(`Empty response for ${cat.name}`);
                        return null;
                    }
                    
                    const doc = await parseHtml(res.body);
                    const items = Array.from(doc.querySelectorAll('div.video-thumb'))
                        .map(el => extractVideoThumb(el))
                        .filter(item => item !== null);
                    
                    // Remove duplicates by URL
                    const seen = new Set();
                    const uniqueItems = items.filter(item => {
                        if (seen.has(item.url)) return false;
                        seen.add(item.url);
                        return true;
                    });
                    
                    if (uniqueItems.length > 0) {
                        return { name: cat.name, items: uniqueItems };
                    }
                } catch (e) {
                    console.error(`Error fetching ${cat.name}: ${e.message}`);
                }
                return null;
            });
            
            const settled = await Promise.all(fetchPromises);
            
            settled.forEach(result => {
                if (result) {
                    results[result.name] = result.items;
                }
            });
            
            cb({ success: true, data: results });
        } catch (e) {
            console.error("Critical getHome Error:", e);
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `${getBaseUrl()}/search?keyword=${encodedQuery}`;
            
            const res = await http_get(url, CONFIG.headers);
            const doc = await parseHtml(res.body);
            
            const items = Array.from(doc.querySelectorAll('div.video-thumb'))
                .map(el => extractVideoThumb(el))
                .filter(item => item !== null);
            
            // Deduplicate
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
            // urlStr might be a JSON string containing {url, poster, type} or just URL
            const urlData = safeJsonParse(urlStr) || { url: urlStr };
            const targetUrl = urlData.url || urlStr;
            
            const res = await http_get(targetUrl, CONFIG.headers);
            const doc = await parseHtml(res.body);
            
            // Extract metadata
            const rawTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || 
                           doc.querySelector('title')?.textContent || 
                           'Unknown';
            const title = cleanTitle(rawTitle.split('S0')[0]);
            const poster = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || 
                          urlData.poster;
            const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            
            // Extract tags
            const tags = Array.from(doc.querySelectorAll("div.tags-list a[rel='tag']"))
                .map(a => a.textContent)
                .filter(Boolean);
            
            // Get recommendations
            const recommendations = Array.from(
                doc.querySelectorAll('div.col-md-4.no-padding-left.mobile div.videos-list.pt_mn_wtch_rlts_prnt .video-wrapper')
            ).map(el => extractVideoThumb(el)).filter(Boolean);
            
            // Get video ID for API calls
            const videoId = doc.querySelector('input#video-id')?.getAttribute('value');
            
            // Determine type based on title
            const type = determineType(rawTitle);
            
            // Fetch links data
            let linksData = null;
            if (videoId) {
                try {
                    const linksRes = await http_get(
                        `${getBaseUrl()}/ajax/resolution_switcher.php?video_id=${videoId}`, 
                        CONFIG.headers
                    );
                    linksData = safeJsonParse(linksRes.body);
                } catch (e) {
                    console.error("Failed to fetch resolution switcher:", e);
                }
            }
            
            // Process links
            const toLoadItem = (res, url, selected) => ({
                quality: (res || '').trim(),
                url: (url || '').trim(),
                selected: selected || false
            });
            
            const dedupeByUrl = (list) => {
                const seen = new LinkedHashSet();
                return list.filter(item => {
                    if (seen.has(item.url)) return false;
                    seen.add(item.url);
                    return true;
                });
            };
            
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
            
            // Fallback to download button if no links found
            if (currentList.length === 0 && popupList.length === 0) {
                try {
                    const downloadEl = doc.querySelector('a.hidden-button.buttonDownloadnew');
                    const onclick = downloadEl?.getAttribute('onclick') || '';
                    const urlMatch = onclick.match(/url=['"]([^'"]+)['"]/);
                    
                    if (urlMatch) {
                        linksOut = {
                            status: 'success',
                            current: [{ quality: '', url: urlMatch[1].trim(), selected: false }],
                            popup: []
                        };
                    }
                } catch (e) {
                    // ignore
                }
            }
            
            // Handle Series
            if (type === 'series') {
                let episodes = [];
                
                // Fetch episodes list
                if (videoId) {
                    try {
                        const epRes = await http_get(
                            `${getBaseUrl()}/ajax/episodes.php?video_id=${videoId}`,
                            CONFIG.headers
                        );
                        const epData = safeJsonParse(epRes.body);
                        
                        if (epData?.episodes && epData.episodes.length > 0) {
                            // Process episodes with concurrency limit
                            const semaphore = { count: 0, max: 6, queue: [] };
                            const acquire = () => {
                                if (semaphore.count < semaphore.max) {
                                    semaphore.count++;
                                    return Promise.resolve();
                                }
                                return new Promise(resolve => semaphore.queue.push(resolve));
                            };
                            const release = () => {
                                semaphore.count--;
                                if (semaphore.queue.length > 0) {
                                    semaphore.count++;
                                    semaphore.queue.shift()();
                                }
                            };
                            
                            const processEpisode = async (ep) => {
                                await acquire();
                                try {
                                    const epUrl = ep.url?.trim();
                                    if (!epUrl) return null;
                                    
                                    const epTitle = ep.title?.trim() || 'Episode';
                                    const parsed = parseSeasonEpisode(epTitle.toLowerCase());
                                    
                                    // Fetch episode details to get links
                                    let epLinksOut = null;
                                    try {
                                        const epPageRes = await http_get(fixUrl(epUrl), CONFIG.headers);
                                        const epDoc = await parseHtml(epPageRes.body);
                                        const innerVideoId = epDoc.querySelector('input#video-id')?.getAttribute('value');
                                        
                                        if (innerVideoId) {
                                            const innerLinksRes = await http_get(
                                                `${getBaseUrl()}/ajax/resolution_switcher.php?video_id=${innerVideoId}`,
                                                CONFIG.headers
                                            );
                                            const innerLinks = safeJsonParse(innerLinksRes.body);
                                            
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
                                            
                                            // Fallback download button
                                            if (innerCurrent.length === 0 && innerPopup.length === 0) {
                                                const dlEl = epDoc.querySelector('a.hidden-button.buttonDownloadnew');
                                                const onclick = dlEl?.getAttribute('onclick') || '';
                                                const match = onclick.match(/url=['"]([^'"]+)['"]/);
                                                if (match) {
                                                    epLinksOut.current = [{ quality: '', url: match[1], selected: false }];
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error("Error fetching episode details:", e);
                                    }
                                    
                                    return new Episode({
                                        name: epTitle,
                                        url: JSON.stringify(epLinksOut || { status: 'error', current: [], popup: [] }),
                                        season: parsed.season || 1,
                                        episode: parsed.episode || 1,
                                        posterUrl: poster
                                    });
                                } finally {
                                    release();
                                }
                            };
                            
                            const epPromises = epData.episodes.map(ep => processEpisode(ep));
                            episodes = (await Promise.all(epPromises)).filter(Boolean);
                        }
                    } catch (e) {
                        console.error("Failed to fetch episodes:", e);
                    }
                }
                
                // If no episodes found, create single episode with main links
                if (episodes.length === 0) {
                    episodes = [new Episode({
                        name: title,
                        url: JSON.stringify(linksOut),
                        season: 1,
                        episode: 1,
                        posterUrl: poster
                    })];
                }
                
                const seriesItem = new MultimediaItem({
                    title: title,
                    url: urlStr,
                    posterUrl: poster,
                    description: description,
                    type: 'series',
                    tags: tags,
                    recommendations: recommendations,
                    episodes: episodes
                });
                
                cb({ success: true, data: seriesItem });
            } else {
                // Movie
                const movieItem = new MultimediaItem({
                    title: title,
                    url: JSON.stringify(linksOut),
                    posterUrl: poster,
                    description: description,
                    type: 'movie',
                    tags: tags,
                    recommendations: recommendations
                });
                
                cb({ success: true, data: movieItem });
            }
        } catch (e) {
            console.error("Load Error:", e);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(dataStr, cb) {
        try {
            const loadData = safeJsonParse(dataStr);
            if (!loadData) {
                throw new Error("Invalid load data");
            }
            
            const streams = [];
            const seenUrls = new Set();
            
            // Combine current and popup, removing duplicates
            const currentUrls = new Set((loadData.current || []).map(i => i.url.trim()));
            const combined = [
                ...(loadData.current || []),
                ...(loadData.popup || []).filter(p => !currentUrls.has(p.url.trim()))
            ];
            
            for (const item of combined) {
                const url = item.url.trim();
                if (!url || seenUrls.has(url)) continue;
                seenUrls.add(url);
                
                const quality = item.quality || 'Auto';
                
                // Check if direct media
                const isDirect = /\.(mkv|mp4|m3u8)(\?.*)?$/i.test(url);
                
                let finalUrl = url;
                
                if (!isDirect) {
                    // Need to resolve download page
                    try {
                        const docRes = await http_get(fixUrl(url), CONFIG.headers);
                        const doc = await parseHtml(docRes.body);
                        const downloadEl = doc.querySelector('a.hidden-button.buttonDownloadnew');
                        const onclick = downloadEl?.getAttribute('href') || downloadEl?.getAttribute('onclick') || '';
                        
                        const urlMatch = onclick.match(/url=['"]([^'"]+)['"]/) || 
                                        onclick.match(/https?:\/\/[^\s'"]+/);
                        
                        if (urlMatch) {
                            finalUrl = urlMatch[1] || urlMatch[0];
                        }
                    } catch (e) {
                        console.error("Failed to resolve URL:", url, e);
                        continue;
                    }
                }
                
                if (finalUrl) {
                    streams.push(new StreamResult({
                        url: finalUrl,
                        quality: quality,
                        source: `Fibwatch${quality ? ' [' + quality + ']' : ''}`,
                        headers: {
                            "Referer": getBaseUrl(),
                            "User-Agent": CONFIG.headers["User-Agent"]
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

    // ==================== EXPORTS ====================
    
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    
})();
