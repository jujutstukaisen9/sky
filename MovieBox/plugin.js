(function() {
  /**
   * BollyFlix - SkyStream Plugin
   * ES5-compatible. Library preserved. Streaming/downloading fixed.
   */

  var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  var CINEMETA_URL = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  var UTILS_URL = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  var BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": manifest.baseUrl + "/"
  };

  // === HELPER FUNCTIONS ===
  function normalizeUrl(url, base) {
    if (!url) return "";
    var raw = String(url).trim();
    if (!raw) return "";
    if (raw.indexOf("//") === 0) return "https:" + raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.indexOf("/") === 0) return base + raw;
    return base + "/" + raw;
  }

  function cleanTitle(raw) {
    if (!raw) return "Unknown";
    return String(raw).replace(/Download\s+/gi, "").replace(/\s+/g, " ").trim();
  }

  function extractQuality(text) {
    if (!text) return "Auto";
    var t = String(text).toLowerCase();
    if (t.indexOf("2160") >= 0 || t.indexOf("4k") >= 0 || t.indexOf("ultra") >= 0) return "4K";
    if (t.indexOf("1080") >= 0 || t.indexOf("full") >= 0) return "1080p";
    if (t.indexOf("1440") >= 0 || t.indexOf("quad") >= 0) return "1440p";
    if (t.indexOf("720") >= 0 || t.indexOf("hd") >= 0) return "720p";
    if (t.indexOf("480") >= 0 || t.indexOf("sd") >= 0) return "480p";
    if (t.indexOf("360") >= 0) return "360p";
    if (t.indexOf("cam") >= 0) return "CAM";
    return "Auto";
  }

  function isSeriesUrl(url) {
    return /series|web-series|season/i.test(String(url));
  }

  function uniqueByUrl(items) {    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.url || seen[it.url]) continue;
      seen[it.url] = true;
      out.push(it);
    }
    return out;
  }

  function safeBase64Decode(str) {
    if (!str) return "";
    try {
      var s = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      return atob(s);
    } catch (_) {
      try { return atob(str); } catch (__) { return ""; }
    }
  }

  function htmlDecode(text) {
    if (!text) return "";
    return String(text)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(parseInt(code, 10)); });
  }

  function textOf(el) {
    if (!el || !el.textContent) return "";
    return htmlDecode(String(el.textContent).replace(/\s+/g, " ").trim());
  }

  // === NETWORK ===
  function request(url, headers) {
    headers = headers || {};
    var opts = {};
    for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
    for (var k in headers) opts[k] = headers[k];
    return http_get(url, opts);
  }

  function isCloudflareBlocked(response, targetUrl) {
    var body = String(response && response.body ? response.body : "");
    var headerServer = "";
    if (response && response.headers) {
      headerServer = (response.headers["server"] || response.headers["Server"] || "").toLowerCase();
    }    var titleMatch = body.match(/<title>([^<]*)</i);
    var title = titleMatch && titleMatch[1] ? titleMatch[1].toLowerCase() : "";
    
    if (body.indexOf("cloudflare") >= 0 && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
    if (title.indexOf("just a moment") >= 0 || title.indexOf("attention required") >= 0) return true;
    if (headerServer.indexOf("cloudflare") >= 0 && /checking your browser|verify you are human/i.test(body)) return true;
    if (String(targetUrl || "").indexOf("/cdn-cgi/challenge-platform/") >= 0) return true;
    return false;
  }

  function loadDoc(url, headers) {
    headers = headers || {};
    return request(url, headers).then(function(res) {
      var finalUrl = String(res && (res.finalUrl || res.url) ? (res.finalUrl || res.url) : url || "");
      if (isCloudflareBlocked(res, finalUrl)) {
        throw new Error("CLOUDFLARE_BLOCKED: " + finalUrl);
      }
      return parseHtml(res.body);
    });
  }

  function fetchDynamicBaseUrl(source) {
    return request(UTILS_URL).then(function(res) {
      try {
        var urls = JSON.parse(res.body);
        return (urls && urls[source] && urls[source].trim) ? urls[source].trim() : null;
      } catch (_) {
        return null;
      }
    }).catch(function(_) { return null; });
  }

  function fetchCinemetaData(type, imdbId) {
    var url = CINEMETA_URL + "/" + type + "/" + imdbId + ".json";
    return request(url, { "Accept": "application/json" }).then(function(res) {
      return JSON.parse(res.body);
    }).catch(function(_) { return null; });
  }

  // === BYPASS ===
  function bypassProtectedLink(id) {
    return request("https://web.sidexfee.com/?id=" + id).then(function(res) {
      var body = String(res.body || "");
      var patterns = [/"link":"([^"]+)"/, /"url":"([^"]+)"/, /data-link="([^"]+)"/];
      for (var i = 0; i < patterns.length; i++) {
        var match = body.match(patterns[i]);
        if (match && match[1]) {
          var decoded = match[1].replace(/\\\//g, "/");
          try { return safeBase64Decode(decoded); } catch(_) { return decoded; }
        }      }
      return null;
    }).catch(function(_) { return null; });
  }

  function resolveFinalUrl(startUrl, maxRedirects) {
    maxRedirects = maxRedirects || 7;
    var currentUrl = startUrl;
    var chain = Promise.resolve();
    for (var i = 0; i < maxRedirects; i++) {
      chain = chain.then(function() {
        var opts = {};
        for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
        opts.allowRedirects = false;
        return http_get(currentUrl, opts);
      }).then(function(res) {
        if (res.code === 200) return currentUrl;
        if (res.code >= 300 && res.code < 400) {
          var location = res.headers && (res.headers["location"] || res.headers["Location"]);
          if (location) {
            currentUrl = location;
            return null;
          }
        }
        return currentUrl;
      });
    }
    return chain.then(function(result) { return result || currentUrl; });
  }

  // === EXTRACTORS ===
  function extractGDFlix(url, streams) {
    return fetchDynamicBaseUrl("gdflix").then(function(latest) {
      var baseUrl = (url.match(/^https?:\/\/[^/]+/) || [""])[0];
      if (latest && baseUrl !== latest) {
        url = url.replace(baseUrl, latest);
        baseUrl = latest;
      }
      return loadDoc(url);
    }).then(function(doc) {
      var nameLi = doc.querySelector("ul > li.list-group-item:contains(Name)");
      var sizeLi = doc.querySelector("ul > li.list-group-item:contains(Size)");
      var fileName = nameLi ? textOf(nameLi).split("Name :")[1] || "" : "";
      var fileSize = sizeLi ? textOf(sizeLi).split("Size :")[1] || "" : "";
      var quality = extractQuality(fileName);

      var buttons = Array.prototype.slice.call(doc.querySelectorAll("div.text-center a"));
      var promises = [];

      for (var bi = 0; bi < buttons.length; bi++) {        (function(anchor) {
          var txt = textOf(anchor).toLowerCase();
          var href = anchor.getAttribute("href");
          if (!href) return;

          var label = "";
          var finalUrl = href;
          var promise = Promise.resolve();

          if (txt.indexOf("fsl v2") >= 0) {
            label = "[FSL V2]";
          } else if (txt.indexOf("direct dl") >= 0 || txt.indexOf("direct server") >= 0) {
            label = "[Direct]";
          } else if (txt.indexOf("cloud download") >= 0 && txt.indexOf("r2") >= 0) {
            label = "[Cloud]";
          } else if (txt.indexOf("fast cloud") >= 0) {
            promise = loadDoc(baseUrl + href).then(function(nested) {
              var dlink = nested.querySelector("div.card-body a");
              if (!dlink) throw new Error("No link");
              finalUrl = dlink.getAttribute("href");
              label = "[FAST CLOUD]";
            }).catch(function() { throw new Error("Skip"); });
          } else if (href.indexOf("pixeldra") >= 0) {
            var base = (href.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
            finalUrl = href.indexOf("download") >= 0 ? href : base + "/api/file/" + href.split("/").pop() + "?download";
            label = "[Pixeldrain]";
          } else if (txt.indexOf("instant dl") >= 0) {
            promise = (function() {
              var opts = {};
              for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
              opts.allowRedirects = false;
              return http_get(href, opts);
            })().then(function(r) {
              var loc = r.headers && (r.headers["location"] || r.headers["Location"]) || "";
              var instant = loc.indexOf("url=") >= 0 ? loc.split("url=")[1] : loc;
              if (instant) { finalUrl = instant; label = "[Instant]"; }
              else throw new Error("Skip");
            }).catch(function() { throw new Error("Skip"); });
          } else if (txt.indexOf("gofile") >= 0) {
            streams.push(new StreamResult({ url: href, source: "Gofile" }));
            return;
          } else {
            return;
          }

          promise.then(function() {
            if (finalUrl && finalUrl.indexOf("http") === 0) {
              streams.push(new StreamResult({
                url: finalUrl,
                source: "GDFlix" + label,                quality: quality,
                headers: { "Referer": url, "User-Agent": UA }
              }));
            }
          }).catch(function(e) {
            if (e.message !== "Skip") console.error("GDFlix error:", e);
          });
          promises.push(promise);
        })(buttons[bi]);
      }

      return Promise.all(promises).then(function() {
        // CF backup
        var cfUrl = url.replace("/file/", "/wfile/");
        if (cfUrl !== url) {
          return loadDoc(cfUrl).then(function(cfDoc) {
            var cfBtns = cfDoc.querySelectorAll("a.btn-success");
            for (var ci = 0; ci < cfBtns.length; ci++) {
              var cfHref = cfBtns[ci].getAttribute("href");
              if (cfHref) {
                resolveFinalUrl(cfHref).then(function(resolved) {
                  if (resolved) {
                    streams.push(new StreamResult({
                      url: resolved,
                      source: "GDFlix[CF]",
                      quality: quality,
                      headers: { "Referer": url, "User-Agent": UA }
                    }));
                  }
                });
              }
            }
          });
        }
      });
    }).catch(function(_) {});
  }

  function extractFastDLServer(url, streams) {
    var opts = {};
    for (var k in BASE_HEADERS) opts[k] = BASE_HEADERS[k];
    opts.allowRedirects = false;
    return http_get(url, opts).then(function(res) {
      var location = res.headers && (res.headers["location"] || res.headers["Location"]);
      if (location) {
        streams.push(new StreamResult({ url: location, source: "FastDL" }));
      }
    }).catch(function(_) {});
  }
  function loadGenericExtractor(url, streams) {
    var hostname = new URL(url).hostname.toLowerCase();
    if (hostname.indexOf("pixeldrain") >= 0) {
      var base = (url.match(/^https?:\/\/[^/]+/) || ["https://pixeldrain.com"])[0];
      var final = url.indexOf("download") >= 0 ? url : base + "/api/file/" + url.split("/").pop() + "?download";
      streams.push(new StreamResult({ url: final, source: "Pixeldrain" }));
    } else if (hostname.indexOf("gofile") >= 0) {
      streams.push(new StreamResult({ url: url, source: "Gofile" }));
    } else {
      streams.push(new StreamResult({ url: url, source: "Generic" }));
    }
  }

  // === CORE FUNCTIONS ===
  function getHome(cb) {
    var sections = [
      { name: "Trending", path: "" },
      { name: "Bollywood Movies", path: "/movies/bollywood/" },
      { name: "Hollywood Movies", path: "/movies/hollywood/" },
      { name: "Anime", path: "/anime/" }
    ];
    var data = {};
    var idx = 0;

    function loadNext() {
      if (idx >= sections.length) {
        cb({ success: true,  data });
        return;
      }
      var section = sections[idx++];
      var url = section.path ? manifest.baseUrl + section.path : manifest.baseUrl;
      loadDoc(url).then(function(doc) {
        var articles = doc.querySelectorAll("div.post-cards > article");
        var items = [];
        for (var ai = 0; ai < articles.length; ai++) {
          var el = articles[ai];
          var anchor = el.querySelector("a");
          if (!anchor) continue;
          var title = cleanTitle(anchor.getAttribute("title"));
          var href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
          var img = el.querySelector("img");
          var poster = img ? normalizeUrl(img.getAttribute("src"), manifest.baseUrl) : "";
          if (!title || !href) continue;
          items.push(new MultimediaItem({ title: title, url: href, posterUrl: poster, type: "movie", contentType: "movie" }));
        }
        if (items.length > 0) data[section.name] = uniqueByUrl(items).slice(0, 30);
        else data[section.name] = [];
      }).catch(function(err) {
        console.error("Error loading section " + section.name + ":", err);
        data[section.name] = [];      }).then(loadNext);
    }
    loadNext();
  }

  function search(query, cb) {
    var q = encodeURIComponent(String(query || "").trim());
    var url = manifest.baseUrl + "/search/" + q + "/page/1/";
    loadDoc(url).then(function(doc) {
      var articles = doc.querySelectorAll("div.post-cards > article");
      var results = [];
      for (var ai = 0; ai < articles.length; ai++) {
        var el = articles[ai];
        var anchor = el.querySelector("a");
        if (!anchor) continue;
        var title = cleanTitle(anchor.getAttribute("title"));
        var href = normalizeUrl(anchor.getAttribute("href"), manifest.baseUrl);
        var img = el.querySelector("img");
        var poster = img ? normalizeUrl(img.getAttribute("src"), manifest.baseUrl) : "";
        if (!title || !href) continue;
        results.push(new MultimediaItem({ title: title, url: href, posterUrl: poster, type: "movie", contentType: "movie" }));
      }
      cb({ success: true,  uniqueByUrl(results).slice(0, 40) });
    }).catch(function(e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message ? e.message : e) });
    });
  }

  function load(url, cb) {
    loadDoc(url).then(function(doc) {
      var titleEl = doc.querySelector("title");
      var title = cleanTitle(titleEl ? titleEl.textContent : "");
      var ogImg = doc.querySelector("meta[property='og:image']");
      var posterUrl = ogImg ? normalizeUrl(ogImg.getAttribute("content"), manifest.baseUrl) : "";
      var summary = doc.querySelector("span#summary");
      var description = summary ? textOf(summary) : "";
      var isSeries = isSeriesUrl(url) || /series|web-series/i.test(title);
      var contentType = isSeries ? "series" : "movie";

      var imdbAnchor = doc.querySelector("div.imdb_left > a");
      var imdbUrl = imdbAnchor ? imdbAnchor.getAttribute("href") : "";
      var cinemetaData = null;

      function loadCinemeta() {
        if (!imdbUrl) return Promise.resolve(null);
        var parts = imdbUrl.split("title/");
        if (parts.length < 2) return Promise.resolve(null);
        var imdbId = parts[1].split("/")[0];
        if (!imdbId) return Promise.resolve(null);
        return fetchCinemetaData(contentType === "series" ? "tv" : "movie", imdbId);      }

      return loadCinemeta().then(function(cm) {
        cinemetaData = cm;
        if (cm && cm.meta) {
          var meta = cm.meta;
          title = meta.name || title;
          description = meta.description || description;
          posterUrl = meta.poster || posterUrl;
          var bgPoster = meta.background || posterUrl;
          var genres = meta.genre || [];
          var cast = meta.cast || [];
          var imdbRating = meta.imdbRating || "";
          var year = meta.year ? parseInt(meta.year) : null;

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

          if (isSeries) {
            var episodesMap = {};
            var buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
            var bi = 0;

            function processButtons() {
              if (bi >= buttons.length) {
                return buildEpisodes();
              }
              var btn = buttons[bi++];
              var link = btn.getAttribute("href");
              if (!link) return processButtons();

              function processLink(finalLink, seasonNum) {
                return loadDoc(finalLink).then(function(seasonDoc) {
                  var epLinks = Array.prototype.slice.call(seasonDoc.querySelectorAll("h3 > a"))
                    .filter(function(a) { return textOf(a).toLowerCase().indexOf("zip") < 0; });
                  var epNum = 1;
                  var epPromises = [];
                  for (var ei = 0; ei < epLinks.length; ei++) {
                    (function(epAnchor, currentEpNum) {
                      var epUrl = epAnchor.getAttribute("href");
                      if (!epUrl) return;
                      var videos = meta.videos || [];                      var epInfo = null;
                      for (var vi = 0; vi < videos.length; vi++) {
                        var v = videos[vi];
                        if (v.season === seasonNum && v.episode === currentEpNum) {
                          epInfo = v;
                          break;
                        }
                      }
                      var epData = {
                        url: epUrl,
                        name: (epInfo && epInfo.name) || (epInfo && epInfo.title) || "Episode " + currentEpNum,
                        season: seasonNum,
                        episode: currentEpNum,
                        posterUrl: (epInfo && epInfo.thumbnail) || posterUrl,
                        description: (epInfo && epInfo.overview) || ""
                      };
                      if (!episodesMap[seasonNum]) episodesMap[seasonNum] = {};
                      episodesMap[seasonNum][currentEpNum] = epData;
                    })(epLinks[ei], epNum);
                    epNum++;
                  }
                  return Promise.all(epPromises);
                });
              }

              if (link.indexOf("id=") >= 0) {
                var id = link.split("id=").pop();
                return bypassProtectedLink(id).then(function(bypassed) {
                  var finalLink = bypassed || link;
                  var parent = btn.parentElement;
                  var prevSibling = parent ? parent.previousElementSibling : null;
                  var seasonText = prevSibling ? textOf(prevSibling) : "";
                  var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
                  var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
                  return processLink(finalLink, seasonNum);
                }).catch(function(_) {}).then(processButtons);
              } else {
                var parent = btn.parentElement;
                var prevSibling = parent ? parent.previousElementSibling : null;
                var seasonText = prevSibling ? textOf(prevSibling) : "";
                var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
                var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
                return processLink(link, seasonNum).catch(function(_) {}).then(processButtons);
              }
            }

            function buildEpisodes() {
              var episodes = [];
              var seasons = Object.keys(episodesMap).map(Number).sort(function(a, b) { return a - b; });
              for (var si = 0; si < seasons.length; si++) {                var season = seasons[si];
                var eps = episodesMap[season];
                var epNums = Object.keys(eps).map(Number).sort(function(a, b) { return a - b; });
                for (var ei = 0; ei < epNums.length; ei++) {
                  var epNum = epNums[ei];
                  var ep = eps[epNum];
                  episodes.push(new Episode({
                    name: ep.name,
                    url: ep.url,
                    season: ep.season,
                    episode: ep.episode,
                    posterUrl: ep.posterUrl,
                    description: ep.description
                  }));
                }
              }
              episodes.sort(function(a, b) { return (a.season - b.season) || (a.episode - b.episode); });

              var fallbackEp = new Episode({
                name: title,
                url: url,
                season: 1,
                episode: 1,
                posterUrl: posterUrl
              });

              var item = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: posterUrl,
                bannerUrl: bgPoster,
                description: description,
                year: year,
                score: imdbRating ? parseFloat(imdbRating) * 10 : null,
                tags: genres,
                cast: actors,
                type: "series",
                contentType: "series",
                episodes: episodes.length > 0 ? episodes : [fallbackEp]
              });
              cb({ success: true,  item });
            }
            return processButtons();
          } else {
            var sources = [];
            var buttons = doc.querySelectorAll("a.dl");
            for (var bi = 0; bi < buttons.length; bi++) {
              var btn = buttons[bi];
              var link = btn.getAttribute("href");
              if (!link) continue;              if (link.indexOf("id=") >= 0) {
                var id = link.split("id=").pop();
                sources.push({ link: link, id: id, bypass: true });
              } else {
                sources.push({ link: link, bypass: false });
              }
            }
            var firstUrl = sources.length > 0 ? sources[0].link : url;
            var item = new MultimediaItem({
              title: title,
              url: url,
              posterUrl: posterUrl,
              bannerUrl: bgPoster,
              description: description,
              year: year,
              score: imdbRating ? parseFloat(imdbRating) * 10 : null,
              tags: genres,
              cast: actors,
              type: "movie",
              contentType: "movie",
              episodes: [new Episode({
                name: title,
                url: firstUrl,
                season: 1,
                episode: 1,
                posterUrl: posterUrl
              })]
            });
            cb({ success: true,  item });
          }
        } else {
          if (isSeries) {
            var episodes = [];
            var buttons = doc.querySelectorAll("a.maxbutton-download-links, a.dl, a.btnn");
            var epNum = 1;
            for (var bi = 0; bi < buttons.length; bi++) {
              var btn = buttons[bi];
              var link = btn.getAttribute("href");
              if (!link) continue;
              if (link.indexOf("id=") >= 0) {
                var id = link.split("id=").pop();
                (function(currentLink, currentId, currentEpNum) {
                  bypassProtectedLink(currentId).then(function(bypassed) {
                    var finalLink = bypassed || currentLink;
                    var parent = btn.parentElement;
                    var prevSibling = parent ? parent.previousElementSibling : null;
                    var seasonText = prevSibling ? textOf(prevSibling) : "";
                    var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
                    var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
                    episodes.push(new Episode({                      name: "Episode " + currentEpNum,
                      url: finalLink,
                      season: seasonNum,
                      episode: currentEpNum,
                      posterUrl: posterUrl
                    }));
                  });
                })(link, id, epNum);
              } else {
                var parent = btn.parentElement;
                var prevSibling = parent ? parent.previousElementSibling : null;
                var seasonText = prevSibling ? textOf(prevSibling) : "";
                var seasonMatch = seasonText.match(/(?:Season|S)(\d+)/i);
                var seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
                episodes.push(new Episode({
                  name: "Episode " + epNum,
                  url: link,
                  season: seasonNum,
                  episode: epNum,
                  posterUrl: posterUrl
                }));
              }
              epNum++;
            }
            var fallbackEp = new Episode({
              name: title,
              url: url,
              season: 1,
              episode: 1,
              posterUrl: posterUrl
            });
            var item = new MultimediaItem({
              title: title,
              url: url,
              posterUrl: posterUrl,
              description: description,
              type: "series",
              contentType: "series",
              episodes: episodes.length > 0 ? episodes : [fallbackEp]
            });
            cb({ success: true,  item });
          } else {
            var sources = [];
            var buttons = doc.querySelectorAll("a.dl");
            for (var bi = 0; bi < buttons.length; bi++) {
              var btn = buttons[bi];
              var link = btn.getAttribute("href");
              if (!link) continue;
              if (link.indexOf("id=") >= 0) {
                var id = link.split("id=").pop();                sources.push({ link: link, id: id, bypass: true });
              } else {
                sources.push({ link: link, bypass: false });
              }
            }
            var firstUrl = sources.length > 0 ? sources[0].link : url;
            var item = new MultimediaItem({
              title: title,
              url: url,
              posterUrl: posterUrl,
              description: description,
              type: "movie",
              contentType: "movie",
              episodes: [new Episode({
                name: title,
                url: firstUrl,
                season: 1,
                episode: 1,
                posterUrl: posterUrl
              })]
            });
            cb({ success: true,  item });
          }
        }
      });
    }).catch(function(e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message ? e.message : e) });
    });
  }

  function loadStreams(data, cb) {
    try {
      var url = String(data || "").trim();
      if (!url || url.indexOf("http") !== 0) {
        return cb({ success: true,  [] });
      }
      var streams = [];
      var srcStr = url.toLowerCase();
      var promise = Promise.resolve();

      if (srcStr.indexOf("gdflix") >= 0 || srcStr.indexOf("gdlink") >= 0) {
        promise = extractGDFlix(url, streams);
      } else if (srcStr.indexOf("fastdlserver") >= 0) {
        promise = extractFastDLServer(url, streams);
      } else {
        loadGenericExtractor(url, streams);
      }

      promise.then(function() {
        var seen = {};        var results = [];
        for (var i = 0; i < streams.length; i++) {
          var s = streams[i];
          if (!s || !s.url || seen[s.url]) continue;
          seen[s.url] = true;
          results.push(s);
        }
        cb({ success: true,  results });
      }).catch(function(e) {
        cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message ? e.message : e) });
      });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  // === EXPORTS ===
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
