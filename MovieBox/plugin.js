(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * ES5-compatible, syntax-safe version
   */

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const CINEMETA = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  const UTILS = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  const HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": manifest.baseUrl + "/"
  };

  // === UTILS ===
  function normUrl(u, base) {
    if (!u) return "";
    u = String(u).trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (/^https?:\/\//i.test(u)) return u;
    return u.indexOf("/") === 0 ? base + u : base + "/" + u;
  }

  function clean(t) {
    return t ? String(t).replace(/Download\s+/gi, "").replace(/\s+/g, " ").trim() : "Unknown";
  }

  function extractQuality(text) {
    if (!text) return "Auto";
    var match = String(text).match(/(\d{3,4})[pP]/);
    if (match && match[1]) {
      var q = parseInt(match[1], 10);
      if (q >= 2160) return "4K";
      if (q >= 1440) return "1440p";
      if (q >= 1080) return "1080p";
      if (q >= 720) return "720p";
      if (q >= 480) return "480p";
    }
    var s = String(text).toLowerCase();
    if (s.indexOf("4k") >= 0 || s.indexOf("2160") >= 0) return "4K";
    if (s.indexOf("1080") >= 0 || s.indexOf("full") >= 0) return "1080p";
    if (s.indexOf("720") >= 0 || s.indexOf("hd") >= 0) return "720p";
    if (s.indexOf("480") >= 0 || s.indexOf("sd") >= 0) return "480p";
    if (s.indexOf("cam") >= 0) return "CAM";
    return "Auto";
  }
  function isSeries(u) { return /series|web-series|season/i.test(String(u)); }
  
  function dedupe(arr) {
    var s = new Set(), r = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (item && item.url && !s.has(item.url)) {
        s.add(item.url);
        r.push(item);
      }
    }
    return r;
  }

  function b64d(str) {
    if (!str) return "";
    try {
      var s = String(str).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) { return ""; }
  }

  function htmlDec(t) {
    if (!t) return "";
    return String(t)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function(_, c) { return String.fromCharCode(parseInt(c, 10)); });
  }
  
  function text(el) {
    return htmlDec((el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim());
  }

  // === NETWORK ===
  async function req(u, h) {
    h = h || {};
    var headers = {};
    for (var k in HEADERS) headers[k] = HEADERS[k];
    for (var k in h) headers[k] = h[k];
    return await http_get(u, headers);
  }

  function isCF(r, url) {
    var b = String(r && r.body ? r.body : "").toLowerCase();
    var titleMatch = b.match(/<title>([^<]*)</i);
    var t = (titleMatch && titleMatch[1] ? titleMatch[1] : "").toLowerCase();
    return (/cloudflare/.test(b) && /attention|verify|just a moment|cf-/i.test(b)) || t.indexOf("just a moment") >= 0;
  }
  async function doc(u, h) {
    h = h || {};
    var r = await req(u, h);
    if (isCF(r, u)) throw new Error("CLOUDFLARE: " + u);
    return await parseHtml(r.body);
  }

  async function dynBase(src) {
    try {
      var r = await req(UTILS);
      var j = JSON.parse(r.body);
      return (j && j[src] && j[src].trim) ? j[src].trim() : null;
    } catch(_) { return null; }
  }
  
  async function cinemeta(type, id) {
    try {
      var r = await req(CINEMETA + "/" + type + "/" + id + ".json", {"Accept": "application/json"});
      return JSON.parse(r.body);
    } catch(_) { return null; }
  }

  // === BYPASS ===
  async function bypass(id) {
    try {
      var r = await req("https://web.sidexfee.com/?id=" + id);
      var body = String(r.body || "");
      var patterns = [
        /"link":"([^"]+)"/,
        /"url":"([^"]+)"/,
        /data-link="([^"]+)"/
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = body.match(patterns[i]);
        if (match && match[1]) {
          var decoded = match[1].replace(/\\\//g, "/");
          try { return b64d(decoded); } catch(_) { return decoded; }
        }
      }
    } catch (_) {}
    return null;
  }

  async function resolveUrl(u, max) {
    max = max || 7;
    var cur = u;
    for (var i = 0; i < max; i++) {
      try {
        var opts = {};        for (var k in HEADERS) opts[k] = HEADERS[k];
        opts.allowRedirects = false;
        var r = await http_get(cur, opts);
        if (r.code === 200) break;
        if (r.code >= 300 && r.code < 400) {
          var loc = r.headers && (r.headers["location"] || r.headers["Location"]);
          if (!loc) break;
          cur = loc;
        } else break;
      } catch (_) { break; }
    }
    return cur;
  }

  // === EXTRACTORS ===
  async function extractGDFlix(url, streams) {
    try {
      var baseUrl = (url.match(/^https?:\/\/[^/]+/) || [""])[0];
      var latest = await dynBase("gdflix");
      if (latest && baseUrl !== latest) {
        url = url.replace(baseUrl, latest);
        baseUrl = latest;
      }

      var d = await doc(url);
      var nameLi = d.querySelector("ul > li:contains(Name)");
      var sizeLi = d.querySelector("ul > li:contains(Size)");
      var fileName = nameLi ? text(nameLi).split("Name :")[1] || "" : "";
      var fileSize = sizeLi ? text(sizeLi).split("Size :")[1] || "" : "";
      var quality = extractQuality(fileName);

      var buttons = Array.from(d.querySelectorAll("div.text-center a, a.btn-success"));
      
      for (var bi = 0; bi < buttons.length; bi++) {
        var anchor = buttons[bi];
        var txt = text(anchor).toLowerCase();
        var href = anchor.getAttribute("href");
        if (!href) continue;

        var label = "";
        var finalUrl = href;

        if (txt.indexOf("fsl v2") >= 0) {
          label = "[FSL V2]";
        } else if (txt.indexOf("direct dl") >= 0 || txt.indexOf("direct server") >= 0) {
          label = "[Direct]";
        } else if (txt.indexOf("cloud download") >= 0 && txt.indexOf("r2") >= 0) {
          label = "[Cloud]";
        } else if (txt.indexOf("fast cloud") >= 0) {
          try {            var nested = await doc(baseUrl + href);
            var dlink = nested.querySelector("div.card-body a");
            if (!dlink) continue;
            finalUrl = dlink.getAttribute("href");
            label = "[FAST CLOUD]";
          } catch (_) { continue; }
        } else if (href.indexOf("pixeldra") >= 0) {
          var base = (href.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
          finalUrl = href.indexOf("download") >= 0 ? href : base + "/api/file/" + href.split("/").pop() + "?download";
          label = "[Pixeldrain]";
        } else if (txt.indexOf("instant dl") >= 0) {
          try {
            var opts = {};
            for (var k in HEADERS) opts[k] = HEADERS[k];
            opts.allowRedirects = false;
            var r = await http_get(href, opts);
            var loc = r.headers && (r.headers["location"] || r.headers["Location"]) || "";
            var instant = loc.indexOf("url=") >= 0 ? loc.split("url=")[1] : loc;
            if (instant) { finalUrl = instant; label = "[Instant]"; }
            else continue;
          } catch (_) { continue; }
        } else if (txt.indexOf("gofile") >= 0) {
          streams.push(new StreamResult({ url: href, source: "Gofile", quality: quality, headers: { "Referer": url, "User-Agent": UA } }));
          continue;
        } else {
          continue;
        }

        if (finalUrl && finalUrl.indexOf("http") === 0) {
          streams.push(new StreamResult({
            url: finalUrl,
            source: "GDFlix" + label,
            quality: quality,
            headers: { "Referer": url, "User-Agent": UA }
          }));
        }
      }

      // CF backup
      try {
        var cfUrl = url.replace("/file/", "/wfile/");
        if (cfUrl !== url) {
          var cfDoc = await doc(cfUrl);
          var cfBtns = cfDoc.querySelectorAll("a.btn-success");
          for (var ci = 0; ci < cfBtns.length; ci++) {
            var cfHref = cfBtns[ci].getAttribute("href");
            if (cfHref) {
              var resolved = await resolveUrl(cfHref);
              if (resolved) {
                streams.push(new StreamResult({                  url: resolved,
                  source: "GDFlix[CF]",
                  quality: quality,
                  headers: { "Referer": url, "User-Agent": UA }
                }));
              }
            }
          }
        }
      } catch (_) {}
    } catch (_) {}
  }

  async function extractFastDL(url, streams) {
    try {
      var opts = {};
      for (var k in HEADERS) opts[k] = HEADERS[k];
      opts.allowRedirects = false;
      var r = await http_get(url, opts);
      var loc = r.headers && (r.headers["location"] || r.headers["Location"]);
      if (loc) {
        streams.push(new StreamResult({ url: loc, source: "FastDL", headers: { "Referer": url, "User-Agent": UA } }));
      }
    } catch (_) {}
  }

  async function loadGenericExtractor(url, streams) {
    var hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.indexOf("pixeldrain") >= 0) {
      var base = (url.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
      var final = url.indexOf("download") >= 0 ? url : base + "/api/file/" + url.split("/").pop() + "?download";
      streams.push(new StreamResult({ url: final, source: "Pixeldrain", headers: { "Referer": url, "User-Agent": UA } }));
    } else if (hostname.indexOf("gofile") >= 0) {
      streams.push(new StreamResult({ url: url, source: "Gofile", headers: { "Referer": url, "User-Agent": UA } }));
    } else {
      streams.push(new StreamResult({ url: url, source: "Generic", headers: { "Referer": url, "User-Agent": UA } }));
    }
  }

  // === CORE FUNCTIONS ===

  async function getHome(cb) {
    try {
      var sections = [
        { name: "Trending", path: "" },
        { name: "Bollywood Movies", path: "/movies/bollywood/" },
        { name: "Hollywood Movies", path: "/movies/hollywood/" },
        { name: "Anime", path: "/anime/" }
      ];      var data = {};

      for (var si = 0; si < sections.length; si++) {
        var sec = sections[si];
        try {
          var url = sec.path ? manifest.baseUrl + sec.path : manifest.baseUrl;
          var d = await doc(url);
          var articles = d.querySelectorAll("div.post-cards > article");
          var items = [];
          for (var ai = 0; ai < articles.length; ai++) {
            var el = articles[ai];
            var a = el.querySelector("a");
            if (!a) continue;
            var title = clean(a.getAttribute("title"));
            var href = normUrl(a.getAttribute("href"), manifest.baseUrl);
            var img = el.querySelector("img");
            var poster = img ? normUrl(img.getAttribute("src"), manifest.baseUrl) : "";
            if (!title || !href) continue;
            items.push(new MultimediaItem({ title: title, url: href, posterUrl: poster, type: "movie", contentType: "movie" }));
          }
          if (items.length > 0) data[sec.name] = dedupe(items).slice(0, 30);
        } catch (e) { data[sec.name] = []; }
      }
      cb({ success: true, data: data });
    } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: String(e) }); }
  }

  async function search(query, cb) {
    try {
      var q = encodeURIComponent(String(query || "").trim());
      var url = manifest.baseUrl + "/search/" + q + "/page/1/";
      var d = await doc(url);
      var articles = d.querySelectorAll("div.post-cards > article");
      var results = [];
      for (var ai = 0; ai < articles.length; ai++) {
        var el = articles[ai];
        var a = el.querySelector("a");
        if (!a) continue;
        var title = clean(a.getAttribute("title"));
        var href = normUrl(a.getAttribute("href"), manifest.baseUrl);
        var img = el.querySelector("img");
        var poster = img ? normUrl(img.getAttribute("src"), manifest.baseUrl) : "";
        if (!title || !href) continue;
        results.push(new MultimediaItem({ title: title, url: href, posterUrl: poster, type: "movie", contentType: "movie" }));
      }
      cb({ success: true, data: dedupe(results).slice(0, 40) });
    } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) }); }
  }

  async function load(url, cb) {    try {
      var d = await doc(url);
      var titleEl = d.querySelector("title");
      var title = clean(titleEl ? titleEl.textContent : "");
      var ogImg = d.querySelector("meta[property='og:image']");
      var poster = ogImg ? normUrl(ogImg.getAttribute("content"), manifest.baseUrl) : "";
      var summary = d.querySelector("span#summary");
      var desc = summary ? text(summary) : "";
      var isSer = isSeries(url) || /series|web-series/i.test(title);

      var imdbA = d.querySelector("div.imdb_left > a");
      var imdbUrl = imdbA ? imdbA.getAttribute("href") : "";
      var cm = null;
      if (imdbUrl) {
        var parts = imdbUrl.split("title/");
        if (parts.length > 1) {
          var id = parts[1].split("/")[0];
          if (id) cm = await cinemeta(isSer ? "tv" : "movie", id);
        }
      }

      if (cm && cm.meta) {
        var m = cm.meta;
        title = m.name || title;
        desc = m.description || desc;
        poster = m.poster || poster;
        var bg = m.background || poster;
        var genres = m.genre || [];
        var cast = m.cast || [];
        var rating = m.imdbRating || "";
        var year = m.year ? parseInt(m.year) : null;
        var actors = [];
        for (var ci = 0; ci < cast.length; ci++) {
          var c = cast[ci];
          var profilePath = c.profile_path || "";
          actors.push(new Actor({
            name: c.name || c,
            role: c.role || c.character || "",
            image: c.image || (profilePath ? "https://image.tmdb.org/t/p/w500" + profilePath : null)
          }));
        }

        if (isSer) {
          var epMap = new Map();
          var buttons = d.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
          
          for (var bi = 0; bi < buttons.length; bi++) {
            var btn = buttons[bi];
            var link = btn.getAttribute("href");
            if (!link) continue;            if (link.indexOf("id=") >= 0) {
              var id = link.split("id=").pop();
              var bypassed = await bypass(id);
              if (bypassed) link = bypassed;
            }
            var parent = btn.parentElement;
            var prevSibling = parent ? parent.previousElementSibling : null;
            var seasonText = prevSibling ? text(prevSibling) : "";
            var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
            var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
            
            try {
              var seasonDoc = await doc(link);
              var epLinks = seasonDoc.querySelectorAll("h3 > a");
              var epNum = 1;
              for (var ei = 0; ei < epLinks.length; ei++) {
                var epA = epLinks[ei];
                if (text(epA).toLowerCase().indexOf("zip") >= 0) continue;
                var epUrl = epA.getAttribute("href");
                if (!epUrl) continue;
                var videos = cm.meta.videos || [];
                var epInfo = null;
                for (var vi = 0; vi < videos.length; vi++) {
                  var v = videos[vi];
                  if (v.season === seasonNum && v.episode === epNum) {
                    epInfo = v;
                    break;
                  }
                }
                var epData = {
                  url: epUrl,
                  name: (epInfo && epInfo.name) || (epInfo && epInfo.title) || "Episode " + epNum,
                  season: seasonNum,
                  episode: epNum,
                  poster: (epInfo && epInfo.thumbnail) || poster,
                  desc: (epInfo && epInfo.overview) || ""
                };
                if (!epMap.has(seasonNum)) epMap.set(seasonNum, new Map());
                epMap.get(seasonNum).set(epNum, epData);
                epNum++;
              }
            } catch (_) {}
          }
          
          var episodes = [];
          var seasons = Array.from(epMap.keys()).sort(function(a, b) { return a - b; });
          for (var sni = 0; sni < seasons.length; sni++) {
            var season = seasons[sni];
            var eps = epMap.get(season);
            var epNums = Array.from(eps.keys()).sort(function(a, b) { return a - b; });            for (var eni = 0; eni < epNums.length; eni++) {
              var epNum = epNums[eni];
              var ep = eps.get(epNum);
              episodes.push(new Episode({
                name: ep.name,
                url: JSON.stringify({ url: ep.url }),
                season: ep.season,
                episode: ep.episode,
                posterUrl: ep.poster,
                description: ep.desc
              }));
            }
          }
          
          var fallbackEp = new Episode({
            name: title,
            url: JSON.stringify({ url: url }),
            season: 1,
            episode: 1,
            posterUrl: poster
          });
          
          var item = new MultimediaItem({
            title: title,
            url: url,
            posterUrl: poster,
            bannerUrl: bg,
            description: desc,
            year: year,
            score: rating ? parseFloat(rating) * 10 : null,
            tags: genres,
            cast: actors,
            type: "series",
            contentType: "series",
            episodes: episodes.length > 0 ? episodes : [fallbackEp]
          });
          cb({ success: true, data: item });
          return;
        } else {
          var sources = [];
          var buttons = d.querySelectorAll("a.dl");
          for (var bi = 0; bi < buttons.length; bi++) {
            var btn = buttons[bi];
            var link = btn.getAttribute("href");
            if (!link) continue;
            if (link.indexOf("id=") >= 0) {
              var id = link.split("id=").pop();
              var bypassed = await bypass(id);
              if (bypassed) link = bypassed;
            }            sources.push({ url: link });
          }
          var firstUrl = sources.length > 0 && sources[0].url ? sources[0].url : url;
          var item = new MultimediaItem({
            title: title,
            url: url,
            posterUrl: poster,
            bannerUrl: bg,
            description: desc,
            year: year,
            score: rating ? parseFloat(rating) * 10 : null,
            tags: genres,
            cast: actors,
            type: "movie",
            contentType: "movie",
            episodes: [new Episode({
              name: title,
              url: JSON.stringify({ url: firstUrl }),
              season: 1,
              episode: 1,
              posterUrl: poster
            })]
          });
          cb({ success: true, data: item });
          return;
        }
      }
      
      // Fallback without Cinemeta
      if (isSer) {
        var episodes = [];
        var buttons = d.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
        var epNum = 1;
        for (var bi = 0; bi < buttons.length; bi++) {
          var btn = buttons[bi];
          var link = btn.getAttribute("href");
          if (!link) continue;
          if (link.indexOf("id=") >= 0) {
            var id = link.split("id=").pop();
            var bypassed = await bypass(id);
            if (bypassed) link = bypassed;
          }
          var parent = btn.parentElement;
          var prevSibling = parent ? parent.previousElementSibling : null;
          var seasonText = prevSibling ? text(prevSibling) : "";
          var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
          var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          episodes.push(new Episode({
            name: "Episode " + epNum,
            url: JSON.stringify({ url: link }),            season: seasonNum,
            episode: epNum,
            posterUrl: poster
          }));
          epNum++;
        }
        var fallbackEp = new Episode({
          name: title,
          url: JSON.stringify({ url: url }),
          season: 1,
          episode: 1,
          posterUrl: poster
        });
        var item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: poster,
          description: desc,
          type: "series",
          contentType: "series",
          episodes: episodes.length > 0 ? episodes : [fallbackEp]
        });
        cb({ success: true, data: item });
      } else {
        var sources = [];
        var buttons = d.querySelectorAll("a.dl");
        for (var bi = 0; bi < buttons.length; bi++) {
          var btn = buttons[bi];
          var link = btn.getAttribute("href");
          if (!link) continue;
          if (link.indexOf("id=") >= 0) {
            var id = link.split("id=").pop();
            var bypassed = await bypass(id);
            if (bypassed) link = bypassed;
          }
          sources.push({ url: link });
        }
        var firstUrl = sources.length > 0 && sources[0].url ? sources[0].url : url;
        var item = new MultimediaItem({
          title: title,
          url: url,
          posterUrl: poster,
          description: desc,
          type: "movie",
          contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: JSON.stringify({ url: firstUrl }),
            season: 1,
            episode: 1,            posterUrl: poster
          })]
        });
        cb({ success: true, data: item });
      }
    } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) }); }
  }

  async function loadStreams(data, cb) {
    try {
      var url = null;
      if (typeof data === "string") {
        try {
          var parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            var first = parsed[0];
            url = (first && first.url) ? first.url : first;
          } else if (parsed && parsed.url) {
            url = parsed.url;
          } else {
            url = parsed;
          }
        } catch(_) { url = data; }
      } else if (Array.isArray(data)) {
        var first = data[0];
        url = (first && first.url) ? first.url : first;
      } else if (data && data.url) {
        url = data.url;
      }
      
      if (!url) return cb({ success: true, data: [] });
      
      var streams = [];
      var srcStr = String(url).toLowerCase();
      
      if (srcStr.indexOf("gdflix") >= 0 || srcStr.indexOf("gdlink") >= 0) {
        await extractGDFlix(url, streams);
      } else if (srcStr.indexOf("fastdlserver") >= 0) {
        await extractFastDL(url, streams);
      } else {
        await loadGenericExtractor(url, streams);
      }
      
      var seen = new Set();
      var results = [];
      for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        if (!s || !s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        results.push(s);      }
      
      cb({ success: true, data: results });
    } catch (e) { cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) }); }
  }

  // === EXPORTS ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
