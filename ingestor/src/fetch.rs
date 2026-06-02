//! Source fetchers: GDELT (DOC 2.0 JSON), RSS/Atom (quick-xml), and generic
//! HTML (scraper). Every outbound request is gated by the SSRF guard, including
//! each redirect hop — the client uses `redirect::Policy::none()` so we
//! re-validate `Location` ourselves before following.

use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

use crate::dates;
use crate::model::{RawItem, Source, SourceKind};
use crate::ssrf;

const USER_AGENT: &str = concat!("mapr-ingestor/", env!("CARGO_PKG_VERSION"));
const MAX_REDIRECTS: usize = 5;
const MAX_ITEMS_PER_SOURCE: usize = 200;
const GDELT_DOC_API: &str = "https://api.gdeltproject.org/api/v2/doc/doc";

/// Build the fetch client: TLS via rustls, redirects DISABLED (we follow them
/// manually so each hop passes the SSRF guard).
pub fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .context("building fetch client")
}

/// GET `url` with per-request `timeout`, following redirects manually and
/// re-validating every hop (origin + each `Location`) through the SSRF guard.
/// Returns `(final_url, body)`.
pub async fn guarded_get(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<(String, String)> {
    let mut current = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        ssrf::assert_public_host(&current)
            .await
            .with_context(|| format!("ssrf guard rejected {current}"))?;
        let resp = client
            .get(&current)
            .timeout(timeout)
            .send()
            .await
            .with_context(|| format!("GET {current}"))?;
        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| anyhow!("redirect from {current} without Location"))?;
            // Resolve relative redirects against the current URL.
            let next = url::Url::parse(&current)
                .and_then(|base| base.join(location))
                .map(|u| u.to_string())
                .unwrap_or_else(|_| location.to_string());
            current = next;
            continue;
        }
        if !status.is_success() {
            bail!("GET {current} returned HTTP {status}");
        }
        let body = resp
            .text()
            .await
            .with_context(|| format!("reading body of {current}"))?;
        return Ok((current, body));
    }
    bail!("too many redirects fetching {url}")
}

/// Fetch + parse a source into raw items (pre-enrichment). Dispatches by kind.
pub async fn fetch_source(
    client: &reqwest::Client,
    source: &Source,
    timeout: Duration,
) -> Result<Vec<RawItem>> {
    let effective_url = match source.kind {
        SourceKind::Gdelt => gdelt_url(&source.url),
        SourceKind::Bluesky => bluesky_url(&source.url),
        SourceKind::Rss | SourceKind::Html => source.url.clone(),
    };
    let (_final_url, body) = guarded_get(client, &effective_url, timeout).await?;
    let now = now_ms();
    let mut items = match source.kind {
        SourceKind::Gdelt => parse_gdelt(&body, &source.name, now)?,
        SourceKind::Bluesky => parse_bluesky(&body, now)?,
        SourceKind::Rss => parse_feed(&body, &source.name, now),
        SourceKind::Html => parse_html(&body, &source.url, &source.name, now),
    };
    items.truncate(MAX_ITEMS_PER_SOURCE);
    Ok(items)
}

/// Build the GDELT DOC API URL. If the source already points at the API, use it
/// verbatim; otherwise treat `raw` as a query string.
fn gdelt_url(raw: &str) -> String {
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return raw.to_string();
    }
    let encoded = urlencode(raw);
    format!("{GDELT_DOC_API}?query={encoded}&mode=artlist&format=json&timespan=24h&maxrecords=75&sort=DateDesc")
}

/// Build the Bluesky public AppView search URL. `query` is the raw keyword
/// search (stored as the source's `url`); no auth is required.
fn bluesky_url(query: &str) -> String {
    format!(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q={}&limit=50&sort=latest",
        urlencode(query)
    )
}

/// Minimal percent-encoding for the GDELT query value (space + reserved chars).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct GdeltResp {
    #[serde(default)]
    articles: Vec<GdeltArticle>,
}

#[derive(Deserialize)]
struct GdeltArticle {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    seendate: String,
    #[serde(default)]
    domain: String,
    #[serde(default)]
    sourcecountry: String,
    #[serde(default)]
    socialimage: Option<String>,
}

/// Parse a GDELT DOC 2.0 `artlist` JSON response.
pub fn parse_gdelt(body: &str, source_name: &str, now: i64) -> Result<Vec<RawItem>> {
    let resp: GdeltResp = serde_json::from_str(body).context("parsing GDELT JSON")?;
    Ok(resp
        .articles
        .into_iter()
        .filter(|a| !a.title.trim().is_empty())
        .map(|a| {
            let published_at = dates::parse_gdelt(&a.seendate).unwrap_or(now);
            let source = if a.domain.is_empty() {
                source_name.to_string()
            } else {
                a.domain
            };
            RawItem {
                title: a.title.trim().to_string(),
                summary: String::new(),
                url: if a.url.is_empty() { None } else { Some(a.url) },
                source,
                published_at,
                source_country: if a.sourcecountry.is_empty() {
                    None
                } else {
                    Some(a.sourcecountry)
                },
                image_url: a.socialimage.filter(|s| s.starts_with("http")),
            }
        })
        .collect())
}

#[derive(Deserialize)]
struct BlueskyResp {
    #[serde(default)]
    posts: Vec<BlueskyPost>,
}

#[derive(Deserialize)]
struct BlueskyPost {
    #[serde(default)]
    uri: String,
    #[serde(default)]
    author: BlueskyAuthor,
    #[serde(default)]
    record: BlueskyRecord,
    #[serde(default)]
    embed: Option<BlueskyEmbed>,
}

#[derive(Deserialize, Default)]
struct BlueskyAuthor {
    #[serde(default)]
    handle: String,
}

#[derive(Deserialize, Default)]
struct BlueskyRecord {
    #[serde(default)]
    text: String,
    #[serde(default, rename = "createdAt")]
    created_at: String,
}

#[derive(Deserialize, Default)]
struct BlueskyEmbed {
    #[serde(default, rename = "$type")]
    type_: String,
    #[serde(default)]
    images: Vec<BlueskyImage>,
}

#[derive(Deserialize, Default)]
struct BlueskyImage {
    #[serde(default)]
    thumb: String,
    #[serde(default)]
    fullsize: String,
}

/// Parse a Bluesky `app.bsky.feed.searchPosts` response. Posts are social,
/// unverified signal, so `source` is attributed as `Bluesky / @<handle>` for
/// the UI to flag. Posts without record text are skipped.
pub fn parse_bluesky(body: &str, now: i64) -> Result<Vec<RawItem>> {
    let resp: BlueskyResp = serde_json::from_str(body).context("parsing Bluesky JSON")?;
    Ok(resp
        .posts
        .into_iter()
        .filter_map(|p| {
            let handle = p.author.handle;
            let text = p.record.text;
            if handle.is_empty() || text.trim().is_empty() {
                return None;
            }
            let title: String = {
                let first_line = text.lines().next().unwrap_or("").trim();
                if first_line.chars().count() > 140 {
                    let truncated: String = first_line.chars().take(140).collect();
                    format!("{truncated}…")
                } else {
                    first_line.to_string()
                }
            };
            // Permalink: rkey is the last `/`-segment of the at:// URI.
            let url = p
                .uri
                .rsplit('/')
                .next()
                .filter(|rkey| !rkey.is_empty())
                .map(|rkey| format!("https://bsky.app/profile/{handle}/post/{rkey}"));
            let published_at = dates::parse_rfc3339(&p.record.created_at).unwrap_or(now);
            let image_url = p.embed.and_then(|e| {
                if e.type_ != "app.bsky.embed.images#view" {
                    return None;
                }
                e.images.into_iter().find_map(|img| {
                    if img.thumb.starts_with("http") {
                        Some(img.thumb)
                    } else if img.fullsize.starts_with("http") {
                        Some(img.fullsize)
                    } else {
                        None
                    }
                })
            });
            Some(RawItem {
                title,
                summary: text,
                url,
                source: format!("Bluesky / @{handle}"),
                published_at,
                source_country: None,
                image_url,
            })
        })
        .collect())
}

/// Parse RSS 2.0 or Atom into raw items (tolerant; missing fields are skipped).
pub fn parse_feed(xml: &str, source_name: &str, now: i64) -> Vec<RawItem> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut items = Vec::new();

    let mut in_item = false;
    let mut field: Option<Field> = None;
    let mut title = String::new();
    let mut link = String::new();
    let mut summary = String::new();
    let mut date = String::new();
    let mut image = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref());
                if in_item && image.is_empty() {
                    if let Some(img) = feed_image(&e, &name) {
                        image = img;
                    }
                }
                match name.as_str() {
                    "item" | "entry" => {
                        in_item = true;
                        title.clear();
                        link.clear();
                        summary.clear();
                        date.clear();
                        image.clear();
                    }
                    "title" if in_item => field = Some(Field::Title),
                    "link" if in_item => {
                        // Atom <link href="..."> — capture the attribute.
                        if let Some(href) = attr(&e, b"href") {
                            if link.is_empty() {
                                link = href;
                            }
                        }
                        field = Some(Field::Link);
                    }
                    "description" | "summary" | "content" if in_item => {
                        field = Some(Field::Summary)
                    }
                    "pubdate" | "published" | "updated" if in_item => field = Some(Field::Date),
                    _ => field = None,
                }
            }
            Ok(Event::Empty(e)) => {
                // Self-closing elements: Atom's <link href="..."/> and feed image
                // elements (media:content/media:thumbnail/enclosure) are the common cases.
                let name = local_name(e.name().as_ref());
                if in_item && image.is_empty() {
                    if let Some(img) = feed_image(&e, &name) {
                        image = img;
                    }
                }
                if in_item && name == "link" && link.is_empty() {
                    let rel = attr(&e, b"rel");
                    if rel.as_deref().is_none() || rel.as_deref() == Some("alternate") {
                        if let Some(href) = attr(&e, b"href") {
                            link = href;
                        }
                    }
                }
            }
            Ok(Event::Text(e)) => {
                // Pass raw (untrimmed): entity refs split a single run into several
                // Text/GeneralRef fragments, so trimming each would drop the spaces
                // between words. Whitespace is normalized once at the end.
                let text = e.decode().map(|c| c.into_owned()).unwrap_or_default();
                capture_field(field, &text, &mut title, &mut link, &mut summary, &mut date);
            }
            Ok(Event::CData(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                capture_field(field, &text, &mut title, &mut link, &mut summary, &mut date);
            }
            Ok(Event::GeneralRef(e)) => {
                // quick-xml emits `&lt;`, `&#39;`, etc. as separate ref events.
                let name = String::from_utf8_lossy(e.as_ref());
                if let Some(resolved) =
                    resolve_entity(name.trim_start_matches('&').trim_end_matches(';'))
                {
                    capture_field(
                        field,
                        &resolved,
                        &mut title,
                        &mut link,
                        &mut summary,
                        &mut date,
                    );
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref());
                match name.as_str() {
                    "item" | "entry" => {
                        in_item = false;
                        field = None;
                        let raw_title = title.trim().to_string();
                        let body = strip_html(summary.trim());
                        // Mastodon/Bluesky RSS items carry no <title> (the post text is the
                        // body) — derive a title from the body so they aren't dropped.
                        let t = if !raw_title.is_empty() {
                            raw_title
                        } else {
                            body.trim().chars().take(140).collect::<String>()
                        };
                        if !t.is_empty() {
                            let published_at = dates::parse_any(date.trim()).unwrap_or(now);
                            items.push(RawItem {
                                title: t,
                                summary: body,
                                url: if link.trim().is_empty() {
                                    None
                                } else {
                                    Some(link.trim().to_string())
                                },
                                source: source_name.to_string(),
                                published_at,
                                source_country: None,
                                image_url: (!image.is_empty()).then(|| image.clone()),
                            });
                        }
                    }
                    _ => field = None,
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break, // tolerate malformed tails
            _ => {}
        }
        buf.clear();
    }
    items
}

#[derive(Clone, Copy)]
enum Field {
    Title,
    Link,
    Summary,
    Date,
}

/// Route a captured text run into the active feed field. Fragments are
/// concatenated raw (entity refs + text nodes belong to one logical run);
/// whitespace is normalized when the element closes.
fn capture_field(
    field: Option<Field>,
    text: &str,
    title: &mut String,
    link: &mut String,
    summary: &mut String,
    date: &mut String,
) {
    let Some(f) = field else { return };
    if text.is_empty() {
        return;
    }
    match f {
        Field::Title => title.push_str(text),
        Field::Link => link.push_str(text),
        Field::Summary => summary.push_str(text),
        Field::Date => date.push_str(text),
    }
}

/// Resolve the built-in + numeric XML entities quick-xml surfaces as refs.
fn resolve_entity(name: &str) -> Option<String> {
    match name {
        "lt" => Some("<".into()),
        "gt" => Some(">".into()),
        "amp" => Some("&".into()),
        "quot" => Some("\"".into()),
        "apos" => Some("'".into()),
        _ => {
            let code =
                if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                    u32::from_str_radix(hex, 16).ok()
                } else {
                    name.strip_prefix('#').and_then(|d| d.parse::<u32>().ok())
                }?;
            char::from_u32(code).map(|c| c.to_string())
        }
    }
}

/// Local element name (drop any XML namespace prefix), lowercased.
fn local_name(raw: &[u8]) -> String {
    let s = String::from_utf8_lossy(raw);
    let local = s.rsplit(':').next().unwrap_or(&s);
    local.to_ascii_lowercase()
}

fn attr(e: &quick_xml::events::BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .map(|a| {
            let raw = String::from_utf8_lossy(&a.value);
            quick_xml::escape::unescape(&raw)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| raw.into_owned())
        })
}

/// Extract a representative image URL from a feed item's element-start event.
/// Handles `<media:content>`, `<media:thumbnail>`, and image `<enclosure>`.
/// `name` is the lowercased local element name. Only http(s) URLs are accepted.
fn feed_image(e: &quick_xml::events::BytesStart, name: &str) -> Option<String> {
    let url = match name {
        // <media:content url="..." medium="image" | type="image/*" | (no type)>
        "content" => {
            let candidate = attr(e, b"url")?;
            let is_image = attr(e, b"medium").as_deref() == Some("image")
                || match attr(e, b"type") {
                    Some(t) => t.starts_with("image/"),
                    None => true,
                };
            is_image.then_some(candidate)?
        }
        // <media:thumbnail url="...">
        "thumbnail" => attr(e, b"url")?,
        // <enclosure url="..." type="image/...">
        "enclosure" => {
            let candidate = attr(e, b"url")?;
            attr(e, b"type")
                .is_some_and(|t| t.starts_with("image/"))
                .then_some(candidate)?
        }
        _ => return None,
    };
    url.starts_with("http").then_some(url)
}

/// Extract title/summary/body from a generic HTML page via scraper.
pub fn parse_html(html: &str, url: &str, source_name: &str, now: i64) -> Vec<RawItem> {
    use scraper::{Html, Selector};

    let doc = Html::parse_document(html);
    let sel = |s: &str| Selector::parse(s).ok();

    let meta_content = |selector: Option<Selector>| -> Option<String> {
        let s = selector?;
        doc.select(&s)
            .next()
            .and_then(|el| el.value().attr("content"))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    let title = meta_content(sel(r#"meta[property="og:title"]"#))
        .or_else(|| {
            sel("title").and_then(|s| {
                doc.select(&s)
                    .next()
                    .map(|el| el.text().collect::<String>().trim().to_string())
            })
        })
        .filter(|t| !t.is_empty());

    let Some(title) = title else {
        return Vec::new();
    };

    let summary = meta_content(sel(r#"meta[name="description"]"#))
        .or_else(|| meta_content(sel(r#"meta[property="og:description"]"#)))
        .unwrap_or_default();

    // Body: first few paragraphs as a fallback summary signal.
    let body = sel("p")
        .map(|s| {
            doc.select(&s)
                .take(8)
                .map(|el| el.text().collect::<String>())
                .filter(|p| p.trim().len() > 40)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();

    let summary = if summary.is_empty() { body } else { summary };

    vec![RawItem {
        title,
        summary: summary.trim().chars().take(1000).collect(),
        url: Some(url.to_string()),
        source: source_name.to_string(),
        published_at: now,
        source_country: None,
        image_url: None,
    }]
}

/// Strip HTML tags from feed summaries (descriptions often contain markup).
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gdelt_url_passthrough_and_query() {
        assert!(
            gdelt_url("https://api.gdeltproject.org/api/v2/doc/doc?query=x")
                .starts_with("https://api.gdeltproject.org")
        );
        let built = gdelt_url("conflict ukraine");
        assert!(built.contains("query=conflict%20ukraine"));
        assert!(built.contains("format=json"));
    }

    #[test]
    fn parse_gdelt_json() {
        let body = r#"{"articles":[
            {"title":"Kyiv reports drone barrage","url":"https://ex.com/a","seendate":"20240131T120000Z","domain":"ex.com","sourcecountry":"Ukraine"},
            {"title":"   ","url":"https://ex.com/empty","seendate":"20240131T120000Z"}
        ]}"#;
        let items = parse_gdelt(body, "GDELT", 999).unwrap();
        assert_eq!(items.len(), 1, "blank title filtered out");
        assert_eq!(items[0].title, "Kyiv reports drone barrage");
        assert_eq!(items[0].source, "ex.com");
        assert_eq!(items[0].published_at, 1_706_702_400_000);
        assert_eq!(items[0].source_country.as_deref(), Some("Ukraine"));
    }

    #[test]
    fn parse_rss_feed() {
        let xml = r#"<?xml version="1.0"?><rss><channel>
            <item>
              <title>Earthquake strikes coast</title>
              <link>https://news.example/quake</link>
              <description>A &lt;b&gt;magnitude 6.1&lt;/b&gt; quake hit the coast.</description>
              <media:content url="https://news.example/img.jpg" medium="image"/>
              <pubDate>Wed, 31 Jan 2024 12:00:00 GMT</pubDate>
            </item>
            <item>
              <title>Second story</title>
              <link>https://news.example/2</link>
            </item>
        </channel></rss>"#;
        let items = parse_feed(xml, "Example", 999);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Earthquake strikes coast");
        assert_eq!(items[0].url.as_deref(), Some("https://news.example/quake"));
        assert_eq!(items[0].summary, "A magnitude 6.1 quake hit the coast.");
        assert_eq!(items[0].published_at, 1_706_702_400_000);
        assert_eq!(items[1].published_at, 999); // no date → caller's now
        assert_eq!(
            items[0].image_url.as_deref(),
            Some("https://news.example/img.jpg")
        );
        assert_eq!(items[1].image_url, None); // no image element → None
    }

    #[test]
    fn parse_feed_image_sources() {
        // <enclosure type="image/jpeg"> wins; non-image enclosure is rejected.
        let xml = r#"<?xml version="1.0"?><rss
            xmlns:media="http://search.yahoo.com/mrss/"><channel>
            <item>
              <title>Enclosure image</title>
              <link>https://n/1</link>
              <enclosure url="https://n/audio.mp3" type="audio/mpeg"/>
              <enclosure url="https://n/photo.jpg" type="image/jpeg"/>
            </item>
            <item>
              <title>Thumbnail only</title>
              <link>https://n/2</link>
              <media:thumbnail url="https://n/thumb.png"/>
            </item>
            <item>
              <title>No image</title>
              <link>https://n/3</link>
              <enclosure url="https://n/file.pdf" type="application/pdf"/>
            </item>
        </channel></rss>"#;
        let items = parse_feed(xml, "Media", 0);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].image_url.as_deref(), Some("https://n/photo.jpg"));
        assert_eq!(items[1].image_url.as_deref(), Some("https://n/thumb.png"));
        assert_eq!(items[2].image_url, None);
    }

    #[test]
    fn parse_atom_feed() {
        let xml = r#"<feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <title>Cyber breach disclosed</title>
              <link href="https://sec.example/breach"/>
              <summary>A data broker disclosed a breach.</summary>
              <updated>2024-01-31T12:00:00Z</updated>
            </entry>
        </feed>"#;
        let items = parse_feed(xml, "Sec", 0);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Cyber breach disclosed");
        assert_eq!(items[0].url.as_deref(), Some("https://sec.example/breach"));
        assert_eq!(items[0].published_at, 1_706_702_400_000);
    }

    #[test]
    fn parse_html_page() {
        let html = r#"<html><head>
            <title>Flood warning issued</title>
            <meta name="description" content="Severe flooding expected across the region tonight.">
            </head><body><p>Short.</p><p>This is a sufficiently long paragraph of body text to be captured by the extractor.</p></body></html>"#;
        let items = parse_html(html, "https://w.example/flood", "Weather", 42);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Flood warning issued");
        assert_eq!(
            items[0].summary,
            "Severe flooding expected across the region tonight."
        );
        assert_eq!(items[0].published_at, 42);
    }

    #[test]
    fn strip_html_removes_tags() {
        assert_eq!(strip_html("<p>Hello <b>world</b></p>"), "Hello world");
    }

    #[test]
    fn bluesky_url_query() {
        let url = bluesky_url("ukraine drone");
        assert!(url.starts_with("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q="));
        assert!(url.contains("q=ukraine%20drone"));
        assert!(url.contains("&limit=50&sort=latest"));
    }

    #[test]
    fn parse_bluesky_posts() {
        let body = r#"{"posts":[
            {
              "uri":"at://did:plc:abc/app.bsky.feed.post/3kxyz",
              "author":{"handle":"reporter.bsky.social","displayName":"Reporter"},
              "record":{"text":"Breaking: explosion reported downtown\nmore details soon","createdAt":"2026-05-31T22:00:00.000Z"},
              "embed":{"$type":"app.bsky.embed.images#view","images":[{"thumb":"https://cdn.bsky.app/t.jpg","fullsize":"https://cdn.bsky.app/f.jpg"}]}
            },
            {
              "uri":"at://did:plc:def/app.bsky.feed.post/3kabc",
              "author":{"handle":"watcher.bsky.social"},
              "record":{"text":"No image here","createdAt":"2026-05-31T22:05:00.000Z"}
            },
            {
              "uri":"at://did:plc:ghi/app.bsky.feed.post/3kskip",
              "author":{"handle":"empty.bsky.social"},
              "record":{"text":"   ","createdAt":"2026-05-31T22:10:00.000Z"}
            }
        ]}"#;
        let items = parse_bluesky(body, 999).unwrap();
        assert_eq!(items.len(), 2, "empty-text post filtered out");

        let first = &items[0];
        assert_eq!(first.source, "Bluesky / @reporter.bsky.social");
        assert_eq!(
            first.url.as_deref(),
            Some("https://bsky.app/profile/reporter.bsky.social/post/3kxyz")
        );
        assert!(first
            .url
            .as_deref()
            .unwrap()
            .starts_with("https://bsky.app/profile/"));
        assert_eq!(first.title, "Breaking: explosion reported downtown");
        assert!(!first.title.is_empty());
        assert_eq!(
            first.summary,
            "Breaking: explosion reported downtown\nmore details soon"
        );
        assert_eq!(
            first.image_url.as_deref(),
            Some("https://cdn.bsky.app/t.jpg")
        );
        assert_eq!(first.published_at, 1_780_264_800_000);
        assert_eq!(first.source_country, None);

        let second = &items[1];
        assert_eq!(second.source, "Bluesky / @watcher.bsky.social");
        assert!(second
            .url
            .as_deref()
            .unwrap()
            .starts_with("https://bsky.app/profile/"));
        assert_eq!(second.image_url, None);
        assert!(!second.title.is_empty());
    }
}
