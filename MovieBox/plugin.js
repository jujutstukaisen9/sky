// FIXED VERSION
(function() {

  var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  var CINEMETA_URL = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";
  var UTILS_URL = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

  var BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,*/*",
    "Referer": manifest.baseUrl + "/"
  };

  function textOf(el) {
    if (!el || !el.textContent) return "";
    return String(el.textContent).replace(/\s+/g, " ").trim();
  }

  function cleanTitle(t) {
    if (!t) return "Unknown";
    return String(t).replace(/Download\s+/gi, "").trim();
  }

  function normalizeUrl(u, base) {
    if (!u) return "";
    if (u.indexOf("http") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return base + u;
    return base + "/" + u;
  }

  function extractQuality(t) {
    if (!t) return "Auto";
    t = t.toLowerCase();
    if (t.includes("4k") || t.includes("2160")) return "4K";
    if (t.includes("1080")) return "1080p";
    if (t.includes("720")) return "720p";
    if (t.includes("480")) return "480p";
    return "Auto";
  }

  function request(url, headers) {
    var opts = Object.assign({}, BASE_HEADERS, headers || {});
    return http_get(url, opts);
  }

  function loadDoc(url) {
    return request(url).then(function(res) {
      return parseHtml(res.body);
    });
  }

  // FIX 1: removed :contains()
  function getNameSize(doc) {
    var lis = doc.querySelectorAll("ul > li");
    var name = "", size = "";

    for (var i = 0; i < lis.length; i++) {
      var t = textOf(lis[i]);
      if (t.indexOf("Name") >= 0) name = t;
      if (t.indexOf("Size") >= 0) size = t;
    }

    return {
      name: name.split("Name :")[1] || "",
      size: size.split("Size :")[1] || ""
    };
  }

  function extractGDFlix(url, streams) {
    return loadDoc(url).then(function(doc) {

      var info = getNameSize(doc);
      var quality = extractQuality(info.name);

      var buttons = doc.querySelectorAll("div.text-center a");
      var promises = [];

      for (var i = 0; i < buttons.length; i++) {
        (function(a) {
          var href = a.getAttribute("href");
          if (!href) return;

          var txt = textOf(a).toLowerCase();

          if (txt.indexOf("direct") >= 0) {
            streams.push(new StreamResult({
              url: href,
              source: "GDFlix",
              quality: quality
            }));
            return;
          }

          if (href.indexOf("pixeldrain") >= 0) {
            var id = href.split("/").pop();
            streams.push(new StreamResult({
              url: "https://pixeldrain.com/api/file/" + id + "?download",
              source: "Pixeldrain",
              quality: quality
            }));
            return;
          }

        })(buttons[i]);
      }
    });
  }

  function loadGeneric(url, streams) {
    if (url.indexOf("pixeldrain") >= 0) {
      var id = url.split("/").pop();
      streams.push(new StreamResult({
        url: "https://pixeldrain.com/api/file/" + id + "?download",
        source: "Pixeldrain"
      }));
    } else {
      streams.push(new StreamResult({ url: url, source: "Direct" }));
    }
  }

  function getHome(cb) {
    loadDoc(manifest.baseUrl).then(function(doc) {
      var arts = doc.querySelectorAll("div.post-cards > article");
      var items = [];

      for (var i = 0; i < arts.length; i++) {
        var a = arts[i].querySelector("a");
        if (!a) continue;

        items.push(new MultimediaItem({
          title: cleanTitle(a.getAttribute("title")),
          url: normalizeUrl(a.getAttribute("href"), manifest.baseUrl),
          posterUrl: normalizeUrl((arts[i].querySelector("img") || {}).src, manifest.baseUrl),
          type: "movie",
          contentType: "movie"
        }));
      }

      cb({ success: true, data: items.slice(0, 30) });

    }).catch(function() {
      cb({ success: false });
    });
  }

  // FIX 2: missing "data" key
  function search(q, cb) {
    var url = manifest.baseUrl + "/search/" + encodeURIComponent(q) + "/page/1/";

    loadDoc(url).then(function(doc) {
      var arts = doc.querySelectorAll("div.post-cards > article");
      var res = [];

      for (var i = 0; i < arts.length; i++) {
        var a = arts[i].querySelector("a");
        if (!a) continue;

        res.push(new MultimediaItem({
          title: cleanTitle(a.getAttribute("title")),
          url: normalizeUrl(a.getAttribute("href"), manifest.baseUrl),
          posterUrl: normalizeUrl((arts[i].querySelector("img") || {}).src, manifest.baseUrl),
          type: "movie",
          contentType: "movie"
        }));
      }

      cb({ success: true, data: res.slice(0, 40) });

    }).catch(function(e) {
      cb({ success: false, message: String(e) });
    });
  }

  function load(url, cb) {
    loadDoc(url).then(function(doc) {

      var title = cleanTitle((doc.querySelector("title") || {}).textContent);
      var poster = normalizeUrl((doc.querySelector("meta[property='og:image']") || {}).content, manifest.baseUrl);

      var btn = doc.querySelector("a.dl");
      var link = btn ? btn.getAttribute("href") : url;

      cb({
        success: true,
        item: new MultimediaItem({
          title: title,
          url: url,
          posterUrl: poster,
          type: "movie",
          contentType: "movie",
          episodes: [new Episode({
            name: title,
            url: link,
            season: 1,
            episode: 1
          })]
        })
      });

    }).catch(function(e) {
      cb({ success: false, message: String(e) });
    });
  }

  function loadStreams(data, cb) {
    var url = String(data || "").trim();
    if (!url.startsWith("http")) return cb({ success: true, data: [] });

    var streams = [];
    var p = Promise.resolve();

    if (url.indexOf("gdflix") >= 0) {
      p = extractGDFlix(url, streams);
    } else {
      loadGeneric(url, streams);
    }

    p.then(function() {
      var seen = {};
      var out = [];

      for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        if (!s.url || seen[s.url]) continue;
        seen[s.url] = 1;
        out.push(s);
      }

      cb({ success: true, data: out });

    }).catch(function(e) {
      cb({ success: false, message: String(e) });
    });
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
