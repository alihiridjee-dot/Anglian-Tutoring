from __future__ import annotations
"""
YouTube search + oEmbed helpers. No API key: the results page ships its whole
payload as `ytInitialData`, which is enough for id / title / channel / duration.

Why not the Data API: it needs a key and a quota, and this job runs a few
thousand queries in one go. Why not yt-dlp: not installed, and this only needs
the search page.
"""
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
# EU consent interstitial replaces the results page without this cookie.
HEADERS = {"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9", "Cookie": "CONSENT=YES+1"}
CTX = ssl.create_default_context()

# sp=EgIQAQ%3D%3D filters to type=Video, which drops channels, playlists and
# the Shorts shelf that otherwise dominate the first rows.
SEARCH = "https://www.youtube.com/results?search_query={q}&sp=EgIQAQ%3D%3D"
OEMBED = "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={v}"


def _get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode("utf-8", "replace")


def _initial_data(html: str) -> dict:
    m = re.search(r"var ytInitialData\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not m:
        m = re.search(r'ytInitialData"\]\s*=\s*(\{.*?\});\s*</script>', html, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}


def _walk(node, out):
    """videoRenderer nodes sit at varying depths; a walk is cheaper than
    tracking every shelf layout YouTube ships."""
    if isinstance(node, dict):
        vr = node.get("videoRenderer")
        if isinstance(vr, dict) and vr.get("videoId"):
            out.append(vr)
        for v in node.values():
            _walk(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk(v, out)


def _text(node) -> str:
    if not isinstance(node, dict):
        return ""
    if "simpleText" in node:
        return node["simpleText"]
    return "".join(r.get("text", "") for r in node.get("runs", []) if isinstance(r, dict))


def _seconds(label: str):
    if not label:
        return None
    parts = label.strip().split(":")
    if not all(p.isdigit() for p in parts):
        return None
    s = 0
    for p in parts:
        s = s * 60 + int(p)
    return s


def search(query: str, limit: int = 20, retries: int = 3) -> list:
    url = SEARCH.format(q=urllib.parse.quote_plus(query))
    html = ""
    for attempt in range(retries):
        try:
            html = _get(url)
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            code = getattr(e, "code", None)
            if attempt == retries - 1:
                return []
            # 429 means backing off harder is the only thing that helps.
            time.sleep((6 if code == 429 else 2) * (attempt + 1))
    raw = []
    _walk(_initial_data(html), raw)
    seen, out = set(), []
    for vr in raw:
        vid = vr["videoId"]
        if vid in seen:
            continue
        seen.add(vid)
        length = _text(vr.get("lengthText"))
        out.append(
            {
                "id": vid,
                "title": _text(vr.get("title")),
                "channel": _text(vr.get("ownerText")) or _text(vr.get("longBylineText")),
                "duration": _seconds(length),
                "length_label": length,
                "published": _text(vr.get("publishedTimeText")),
                "views": _text(vr.get("viewCountText")),
                "description": _text(vr.get("detailedMetadataSnippets", [{}])[0].get("snippetText"))
                if vr.get("detailedMetadataSnippets")
                else "",
            }
        )
        if len(out) >= limit:
            break
    return out


def oembed(video_id: str, retries: int = 2):
    """(status, title, channel). 200 = live AND embeddable. 401/403 = the
    uploader disabled embedding: the video plays on youtube.com but renders
    'Video unavailable' in our iframe, so it must be rejected too."""
    url = OEMBED.format(v=video_id)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
                d = json.loads(r.read().decode("utf-8", "replace"))
                return 200, d.get("title", ""), d.get("author_name", "")
        except urllib.error.HTTPError as e:
            return e.code, "", ""
        except Exception:
            if attempt == retries - 1:
                return 0, "", ""
            time.sleep(2)
    return 0, "", ""
