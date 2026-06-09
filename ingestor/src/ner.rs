//! Lightweight named-entity extraction (no model): pull proper-noun phrases
//! (people / orgs / places) from headlines as maximal runs of capitalized words,
//! allowing a few connectors ("of", "and", …). Good enough to drive the entity
//! co-occurrence graph on real news text; deterministic and fast.

use std::collections::HashSet;

const MAX_ENTITIES: usize = 16;

// Capitalized sentence-initial / headline words that are not entities.
const STOP: &[&str] = &[
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "of",
    "for",
    "and",
    "or",
    "to",
    "but",
    "with",
    "from",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "this",
    "that",
    "these",
    "those",
    "it",
    "he",
    "she",
    "they",
    "we",
    "i",
    "you",
    "his",
    "her",
    "their",
    "our",
    "after",
    "before",
    "over",
    "under",
    "amid",
    "says",
    "said",
    "report",
    "reports",
    "new",
    "why",
    "how",
    "what",
    "when",
    "where",
    "who",
    "live",
    "update",
    "updates",
    "breaking",
    "watch",
    "video",
    "opinion",
    "analysis",
    "exclusive",
    "more",
    "most",
    "first",
    "last",
    "us",
    "u.s",
    "uk",
    "continue",
    "read",
    "reading",
    "follow",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "today",
    "tomorrow",
    "yesterday",
    // Wire services / news agencies: they appear as dateline credits ("KYIV
    // (Reuters) -") and bylines, not as story entities. Lowercased for the
    // case-insensitive `is_stop` check.
    "reuters",
    "ap",
    "afp",
    "dpa",
    "efe",
    "ansa",
    "pti",
    "ians",
    "xinhua",
    "tass",
    "ria",
    "interfax",
    "kyodo",
    "yonhap",
    "cnn",
    "bbc",
    "npr",
    "pbs",
    "msnbc",
    "cnbc",
    "abc",
    "cbs",
    "nbc",
    "fox",
    "aljazeera",
    "jazeera",
    "reuter",
    "bloomberg",
    "politico",
    "axios",
    "guardian",
    "telegraph",
];
const CONNECTORS: &[&str] = &["of", "and", "the", "for", "de", "da", "del", "la", "el"];

fn clean(word: &str) -> &str {
    word.trim_matches(|c: char| !c.is_alphanumeric())
}

fn is_capitalized(word: &str) -> bool {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => {
            c.is_uppercase() && word.chars().any(|c| c.is_alphabetic()) && word.chars().count() >= 2
        }
        None => false,
    }
}

fn is_stop(word: &str) -> bool {
    STOP.contains(&word.to_lowercase().as_str())
}

/// True if `cleaned` is an all-caps (or all-caps-with-digits) alphabetic token
/// whose letters are every uppercase. Used to spot dateline credits.
fn is_all_caps(cleaned: &str) -> bool {
    let mut has_alpha = false;
    for c in cleaned.chars() {
        if c.is_alphabetic() {
            has_alpha = true;
            if !c.is_uppercase() {
                return false;
            }
        }
    }
    has_alpha
}

/// A *leading* dateline token: an ALL-CAPS word whose RAW form is immediately
/// followed by ',' or '(' — e.g. "KYIV," or "WASHINGTON(" in "WASHINGTON
/// (Reuters) -". These are place credits, not story entities, so they're
/// dropped from extraction. `raw` is the un-cleaned whitespace token.
fn is_dateline_token(raw: &str) -> bool {
    let cleaned = clean(raw);
    if cleaned.chars().count() < 2 || !is_all_caps(cleaned) {
        return false;
    }
    // The raw token must carry a trailing ',' or '(' directly after the word.
    let trailing = raw.trim_start_matches(|c: char| !c.is_alphanumeric());
    let after = trailing.trim_start_matches(|c: char| c.is_alphanumeric());
    matches!(after.chars().next(), Some(',') | Some('('))
}

/// Reject pure 2-char ALL-CAPS tokens (e.g. dateline state/agency abbreviations
/// like "DC", "NY", "AP") that are not meaningful standalone entities.
fn is_two_char_all_caps(cleaned: &str) -> bool {
    cleaned.chars().count() == 2 && is_all_caps(cleaned)
}

/// Extract up to [`MAX_ENTITIES`] distinct proper-noun phrases from title + summary.
pub fn extract_entities(title: &str, summary: &str) -> Vec<String> {
    let text = format!("{title}. {summary}");
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut i = 0;
    while i < words.len() {
        let w = clean(words[i]);
        // Drop a leading ALL-CAPS dateline token ("KYIV," / "WASHINGTON (") and
        // reject pure 2-char all-caps tokens ("DC", "NY") that leak as entities.
        if is_dateline_token(words[i]) || is_two_char_all_caps(w) {
            i += 1;
            continue;
        }
        if is_capitalized(w) && !is_stop(w) {
            let mut phrase = vec![w];
            let mut j = i + 1;
            while j < words.len() {
                let nw = clean(words[j]);
                let connector = CONNECTORS.contains(&nw.to_lowercase().as_str())
                    && j + 1 < words.len()
                    && is_capitalized(clean(words[j + 1]));
                // Stop at a dateline credit or a bare 2-char all-caps token so
                // they never get folded into a phrase.
                if (is_capitalized(nw) || connector)
                    && !is_dateline_token(words[j])
                    && !is_two_char_all_caps(nw)
                {
                    phrase.push(nw);
                    j += 1;
                } else {
                    break;
                }
            }
            // Trim a trailing connector ("Bank of" -> "Bank").
            while phrase
                .last()
                .map(|w| CONNECTORS.contains(&w.to_lowercase().as_str()))
                .unwrap_or(false)
            {
                phrase.pop();
            }
            if phrase.iter().any(|x| !is_stop(x)) {
                let p = phrase.join(" ");
                let key = p.to_lowercase();
                if p.len() >= 2 && seen.insert(key) {
                    out.push(p);
                }
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    out.truncate(MAX_ENTITIES);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_proper_nouns() {
        let e = extract_entities("Russia launches strikes on Kyiv as NATO warns", "");
        assert!(e.contains(&"Russia".to_string()));
        assert!(e.contains(&"Kyiv".to_string()));
        assert!(e.contains(&"NATO".to_string()));
    }

    #[test]
    fn joins_connectors_and_trims() {
        let e = extract_entities(
            "United Nations condemns attack",
            "The Bank of England raised rates",
        );
        assert!(e.contains(&"United Nations".to_string()));
        assert!(e.iter().any(|x| x == "Bank of England"));
    }

    #[test]
    fn drops_stopwords_and_short_tokens() {
        let e = extract_entities("The new report says markets fell", "");
        // "The", "new" are stopwords; no all-lowercase tokens captured.
        assert!(!e.iter().any(|x| x.eq_ignore_ascii_case("the")));
        assert!(!e.iter().any(|x| x == "I"));
    }

    #[test]
    fn drops_wire_services_datelines_and_short_caps() {
        // Wire services in the dateline/byline must not surface as entities,
        // and the leading "KYIV," dateline credit is dropped — but the real
        // story entity ("Zelensky") survives.
        let e = extract_entities(
            "Zelensky meets allies in Kyiv",
            "KYIV, Ukraine (Reuters) - President Zelensky addressed reporters. The AP and AFP confirmed the meeting.",
        );
        assert!(
            e.iter().any(|x| x == "Zelensky"),
            "real entity must survive: {e:?}"
        );
        assert!(
            !e.iter().any(|x| x.eq_ignore_ascii_case("reuters")),
            "wire service leaked: {e:?}"
        );
        assert!(
            !e.iter().any(|x| x.eq_ignore_ascii_case("ap")),
            "AP leaked: {e:?}"
        );
        assert!(
            !e.iter().any(|x| x.eq_ignore_ascii_case("afp")),
            "AFP leaked: {e:?}"
        );
        // The leading "KYIV," dateline token is dropped (the city still appears
        // in the title as the proper-cased "Kyiv", which is fine).
        assert!(
            !e.iter().any(|x| x == "KYIV"),
            "all-caps dateline token leaked: {e:?}"
        );
    }

    #[test]
    fn rejects_two_char_all_caps_tokens() {
        let e = extract_entities("Storm hits DC and NY hard", "");
        assert!(!e.iter().any(|x| x == "DC"), "2-char all-caps leaked: {e:?}");
        assert!(!e.iter().any(|x| x == "NY"), "2-char all-caps leaked: {e:?}");
    }
}
