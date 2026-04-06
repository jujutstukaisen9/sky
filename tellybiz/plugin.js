(function () {
  /**
   * @type {import('@skystream/sdk').Manifest}
   */
  // manifest is provided by SkyStream runtime.

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  function baseUrl() {
    return (manifest && manifest.baseUrl ? String(manifest.baseUrl) : "https://tellybiz.in").replace(/\/$/, "");
  }

  function absUrl(input, base) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return "https:" + raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    const root = String(base || baseUrl()).replace(/\/$/, "");
    if (raw.startsWith("/")) return root + raw;
    return root + "/" + raw;
  }

  function decodeHtml(str) {
    return String(str || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }

  function textOf(node) {
    return decodeHtml((node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim());
  }

  function attr(node, ...names) {
    if (!node || !names) return "";
    for (const n of names) {
      const v = node.getAttribute(n);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function toIntQuality(label) {
    const t = String(label || "").toLowerCase();
    if (t.includes("4k") || t.includes("2160")) return 2160;
    const m = t.match(/(\d{3,4})p/);
    if (m) return Number(m[1]);
    if (t.includes("hd")) return 720;
    return 0;
  }

  function qualityLabel(labelOrUrl) {
    const t = String(labelOrUrl || "").toLowerCase();
    if (t.includes("4k") || t.includes("2160")) return "4K";
    if (t.includes("1080")) return "1080p";
    if (t.includes("720")) return "720p";
    if (t.includes("480")) return "480p";
    if (t.includes("360")) return "360p";
    if (t.includes("240")) return "240p";
    return "Auto";
  }

  async function request(url, extraHeaders = {}) {
    const headers = Object.assign(
      {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: baseUrl() + "/",
      },
      extraHeaders || {}
    );

    try {
      return await http_get(url, { headers });
    } catch (_) {
      return await http_get(url, headers);
    }
  }

  async function loadDoc(url, extraHeaders = {}) {
    const res = await request(url, extraHeaders);
    return parseHtml(String(res && res.body ? res.body : ""));
  }

  function uniqueBy(items, keyFn) {
    const out = [];
    const seen = new Set();
    for (const item of items || []) {
      const k = keyFn(item);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }

  function parsePosterItem(anchor) {
    const href = absUrl(attr(anchor, "href"), baseUrl());
    if (!/loanid\.php\?lid=/i.test(href)) return null;

    const img = anchor.querySelector("img");
    const title =
      textOf(anchor.querySelector("h2, h3, h4, .title")) ||
      decodeHtml(attr(img, "alt")) ||
      decodeHtml(attr(anchor, "title")) ||
      textOf(anchor);

    if (!title) return null;

    const posterUrl = absUrl(attr(img, "data-src", "src"), baseUrl());
    return new MultimediaItem({
      title,
      url: href,
      posterUrl,
      type: "movie",
      contentType: "movie",
    });
  }

  function parseLoanItems(doc) {
    const anchors = Array.from(doc.querySelectorAll("a[href*='loanid.php?lid=']"));
    const items = anchors.map(parsePosterItem).filter(Boolean);
    return uniqueBy(items, (x) => x.url);
  }

  async function fetchCategory(path) {
    const url = absUrl(path, baseUrl());
    const doc = await loadDoc(url);
    return parseLoanItems(doc);
  }

  async function getHome(cb) {
    try {
      const data = {};

      const homeItems = await fetchCategory("/");
      if (homeItems.length > 0) {
        data.Trending = homeItems.slice(0, 30);
      }

      let menuSections = [];
      try {
        const doc = await loadDoc(baseUrl() + "/");
        menuSections = Array.from(doc.querySelectorAll("nav a[href], .menu a[href], header a[href]"))
          .map((a) => ({
            name: textOf(a),
            href: absUrl(attr(a, "href"), baseUrl()),
          }))
          .filter((s) => s.name && s.href && !/loanid\.php|loanagreement\.php|\?s=/i.test(s.href))
          .slice(0, 8);
      } catch (_) {}

      for (const sec of menuSections) {
        try {
          const items = await fetchCategory(sec.href);
          if (items.length > 0) data[sec.name] = items.slice(0, 30);
        } catch (_) {}
      }

      cb({ success: true, data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  async function search(query, cb) {
    try {
      const q = String(query || "").trim();
      if (!q) return cb({ success: true, data: [] });

      const searchUrl = baseUrl() + "/?s=" + encodeURIComponent(q);
      const doc = await loadDoc(searchUrl);
      const items = parseLoanItems(doc);
      cb({ success: true, data: items.slice(0, 60) });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  function parseQualityPageCandidates(doc, pageUrl) {
    const links = [];

    const qualityAnchors = Array.from(doc.querySelectorAll("a[href*='loanagreement.php?lid=']"));
    for (const a of qualityAnchors) {
      const href = absUrl(attr(a, "href"), baseUrl());
      const label = textOf(a);
      links.push({ quality: qualityLabel(label || href), page: href });
    }

    let lid = "";
    try {
      lid = new URL(pageUrl).searchParams.get("lid") || "";
    } catch (_) {
      lid = "";
    }

    // Fallback probe for f=0..7 when quality anchors are missing.
    if (lid && links.length === 0) {
      for (let i = 0; i < 8; i++) {
        links.push({
          quality: i === 0 ? "Auto" : "Mirror " + (i + 1),
          page: baseUrl() + "/loanagreement.php?lid=" + encodeURIComponent(lid) + "&f=" + i,
        });
      }
    }

    return uniqueBy(links, (x) => x.page);
  }

  async function load(url, cb) {
    try {
      const pageUrl = absUrl(url, baseUrl());
      const doc = await loadDoc(pageUrl);

      const title =
        textOf(doc.querySelector("h1, h2")) ||
        decodeHtml(attr(doc.querySelector("meta[property='og:title']"), "content")) ||
        "Unknown";

      const posterUrl =
        absUrl(attr(doc.querySelector("meta[property='og:image']"), "content"), baseUrl()) ||
        absUrl(attr(doc.querySelector("img"), "src", "data-src"), baseUrl());

      const description =
        decodeHtml(attr(doc.querySelector("meta[property='og:description'], meta[name='description']"), "content")) ||
        textOf(doc.querySelector("article p, .entry-content p, p"));

      const qualityCandidates = parseQualityPageCandidates(doc, pageUrl);
      const episodeUrlPayload = JSON.stringify({
        sourcePage: pageUrl,
        qualities: qualityCandidates,
      });

      const item = new MultimediaItem({
        title,
        url: pageUrl,
        posterUrl,
        type: "movie",
        contentType: "movie",
        description,
        episodes: [
          new Episode({
            name: title,
            url: episodeUrlPayload,
            season: 1,
            episode: 1,
            posterUrl,
          }),
        ],
      });

      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  function extractDirectMediaLinks(content, fallbackBase) {
    const body = String(content || "")
      .replace(/\\u002F/gi, "/")
      .replace(/\\u003A/gi, ":")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const found = [];
    const patterns = [
      /(https?:\/\/[^\s"'<>]+?\.(?:mkv|mp4|m3u8|avi|mov|webm)(?:\?[^\s"'<>]*)?)/gi,
      /href\s*=\s*["']([^"']+?\.(?:mkv|mp4|m3u8|avi|mov|webm)(?:\?[^"']*)?)["']/gi,
      /(https?:\/\/cdn\.[^\s"'<>]+)/gi,
    ];

    for (const re of patterns) {
      let m;
      while ((m = re.exec(body)) !== null) {
        const u = absUrl(m[1], fallbackBase || baseUrl());
        if (/\.(mkv|mp4|m3u8|avi|mov|webm)(\?|$)/i.test(u) || /cdn\./i.test(u)) {
          found.push(u);
        }
      }
    }

    return uniqueBy(found, (x) => x);
  }

  async function loadStreams(url, cb) {
    try {
      let payload = null;
      try {
        payload = JSON.parse(String(url || ""));
      } catch (_) {
        payload = { qualities: [{ quality: "Auto", page: String(url || "") }] };
      }

      const qualityPages = (payload && Array.isArray(payload.qualities) ? payload.qualities : [])
        .filter((q) => q && q.page)
        .slice(0, 12);

      const streams = [];
      for (const qp of qualityPages) {
        try {
          const res = await request(qp.page, { Referer: payload.sourcePage || baseUrl() + "/" });
          const html = String(res && res.body ? res.body : "");
          const directLinks = extractDirectMediaLinks(html, qp.page);
          for (const mediaUrl of directLinks) {
            const label = qualityLabel(qp.quality + " " + mediaUrl);
            streams.push(
              new StreamResult({
                url: mediaUrl,
                quality: label,
                source: "TellyBiz " + label,
                headers: {
                  Referer: qp.page,
                  "User-Agent": UA,
                },
              })
            );
          }
        } catch (_) {}
      }

      const deduped = uniqueBy(streams, (s) => String(s.url || "") + "|" + String(s.quality || ""));
      deduped.sort((a, b) => toIntQuality(b.quality) - toIntQuality(a.quality));
      cb({ success: true, data: deduped });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message ? e.message : e) });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
