//! Static gazetteer geocoder: resolves a country (ISO-3166 alpha-2) + centroid
//! `(lon, lat)` from article title/summary text.
//!
//! Cities are tried first (most specific), then country names, then demonyms
//! (e.g. "Ukrainian" → UA). Matching is whole-word (space-padded normalized
//! haystack) so "Niger" never matches inside "Nigeria" and "iran" never matches
//! inside "iranian". No network/API — fully deterministic and testable.

/// (lon, lat) centroid.
pub type LonLat = (f64, f64);

/// Resolved geocode: ISO alpha-2 + centroid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geo {
    pub iso_a2: &'static str,
    pub lon: f64,
    pub lat: f64,
}

/// (city name, iso, lon, lat) — ~70 major cities.
const CITIES: &[(&str, &str, f64, f64)] = &[
    ("kyiv", "UA", 30.52, 50.45),
    ("kiev", "UA", 30.52, 50.45),
    ("moscow", "RU", 37.62, 55.75),
    ("london", "GB", -0.13, 51.51),
    ("paris", "FR", 2.35, 48.85),
    ("berlin", "DE", 13.40, 52.52),
    ("madrid", "ES", -3.70, 40.42),
    ("rome", "IT", 12.50, 41.90),
    ("tokyo", "JP", 139.69, 35.69),
    ("beijing", "CN", 116.40, 39.90),
    ("shanghai", "CN", 121.47, 31.23),
    ("delhi", "IN", 77.21, 28.61),
    ("mumbai", "IN", 72.88, 19.08),
    ("washington", "US", -77.04, 38.91),
    ("new york", "US", -74.01, 40.71),
    ("los angeles", "US", -118.24, 34.05),
    ("chicago", "US", -87.63, 41.88),
    ("toronto", "CA", -79.38, 43.65),
    ("mexico city", "MX", -99.13, 19.43),
    ("sao paulo", "BR", -46.63, -23.55),
    ("são paulo", "BR", -46.63, -23.55),
    ("rio de janeiro", "BR", -43.20, -22.91),
    ("buenos aires", "AR", -58.38, -34.60),
    ("cairo", "EG", 31.24, 30.04),
    ("lagos", "NG", 3.38, 6.52),
    ("nairobi", "KE", 36.82, -1.29),
    ("johannesburg", "ZA", 28.05, -26.20),
    ("cape town", "ZA", 18.42, -33.93),
    ("istanbul", "TR", 28.98, 41.01),
    ("ankara", "TR", 32.85, 39.93),
    ("tehran", "IR", 51.39, 35.69),
    ("baghdad", "IQ", 44.36, 33.31),
    ("riyadh", "SA", 46.72, 24.69),
    ("dubai", "AE", 55.27, 25.20),
    ("jerusalem", "IL", 35.21, 31.77),
    ("tel aviv", "IL", 34.78, 32.08),
    ("gaza", "PS", 34.47, 31.50),
    ("beirut", "LB", 35.50, 33.89),
    ("damascus", "SY", 36.29, 33.51),
    ("amman", "JO", 35.93, 31.95),
    ("kabul", "AF", 69.21, 34.56),
    ("islamabad", "PK", 73.06, 33.69),
    ("karachi", "PK", 67.01, 24.86),
    ("dhaka", "BD", 90.41, 23.81),
    ("bangkok", "TH", 100.50, 13.76),
    ("jakarta", "ID", 106.85, -6.21),
    ("manila", "PH", 120.98, 14.60),
    ("seoul", "KR", 126.98, 37.57),
    ("pyongyang", "KP", 125.76, 39.04),
    ("hanoi", "VN", 105.83, 21.03),
    ("singapore", "SG", 103.82, 1.35),
    ("kuala lumpur", "MY", 101.69, 3.1390),
    ("sydney", "AU", 151.21, -33.87),
    ("melbourne", "AU", 144.96, -37.81),
    ("auckland", "NZ", 174.76, -36.85),
    ("warsaw", "PL", 21.01, 52.23),
    ("amsterdam", "NL", 4.90, 52.37),
    ("brussels", "BE", 4.35, 50.85),
    ("vienna", "AT", 16.37, 48.21),
    ("stockholm", "SE", 18.07, 59.33),
    ("oslo", "NO", 10.75, 59.91),
    ("helsinki", "FI", 24.94, 60.17),
    ("copenhagen", "DK", 12.57, 55.68),
    ("athens", "GR", 23.73, 37.98),
    ("lisbon", "PT", -9.14, 38.72),
    ("dublin", "IE", -6.26, 53.35),
    ("kinshasa", "CD", 15.27, -4.44),
    ("addis ababa", "ET", 38.74, 9.03),
    ("khartoum", "SD", 32.53, 15.50),
    ("sanaa", "YE", 44.21, 15.35),
    ("caracas", "VE", -66.90, 10.48),
    ("bogota", "CO", -74.07, 4.71),
    ("lima", "PE", -77.04, -12.05),
    ("santiago", "CL", -70.65, -33.46),
];

/// (country name/alias, iso, lon, lat) — all countries with centroids.
const COUNTRIES: &[(&str, &str, f64, f64)] = &[
    ("united states", "US", -103.57, 44.76),
    ("usa", "US", -103.57, 44.76),
    ("america", "US", -103.57, 44.76),
    ("united kingdom", "GB", -2.76, 53.81),
    ("britain", "GB", -2.76, 53.81),
    ("england", "GB", -2.76, 53.81),
    ("france", "FR", -6.80, 43.14),
    ("germany", "DE", 10.27, 51.08),
    ("spain", "ES", -3.62, 40.32),
    ("italy", "IT", 12.27, 42.67),
    ("portugal", "PT", -8.06, 39.61),
    ("ireland", "IE", -8.02, 53.17),
    ("netherlands", "NL", 5.50, 52.29),
    ("belgium", "BE", 4.59, 50.65),
    ("luxembourg", "LU", 5.97, 49.76),
    ("switzerland", "CH", 8.12, 46.79),
    ("austria", "AT", 14.06, 47.62),
    ("sweden", "SE", 16.11, 62.42),
    ("norway", "NO", 12.83, 66.65),
    ("finland", "FI", 26.14, 64.26),
    ("denmark", "DK", 9.89, 56.06),
    ("iceland", "IS", -18.77, 65.08),
    ("poland", "PL", 19.34, 52.13),
    ("czechia", "CZ", 15.34, 49.78),
    ("czech republic", "CZ", 15.34, 49.78),
    ("slovakia", "SK", 19.50, 48.73),
    ("hungary", "HU", 19.34, 47.20),
    ("romania", "RO", 24.95, 45.85),
    ("bulgaria", "BG", 25.19, 42.76),
    ("greece", "GR", 22.72, 39.04),
    ("croatia", "HR", 16.57, 45.01),
    ("slovenia", "SI", 14.93, 46.13),
    ("serbia", "RS", 20.84, 44.22),
    ("bosnia", "BA", 17.82, 44.18),
    ("bosnia and herzegovina", "BA", 17.82, 44.18),
    ("montenegro", "ME", 19.29, 42.79),
    ("north macedonia", "MK", 21.70, 41.61),
    ("macedonia", "MK", 21.70, 41.61),
    ("albania", "AL", 20.03, 41.13),
    ("kosovo", "XK", 20.90, 42.58),
    ("estonia", "EE", 25.83, 58.64),
    ("latvia", "LV", 24.84, 56.82),
    ("lithuania", "LT", 23.89, 55.28),
    ("belarus", "BY", 27.96, 53.50),
    ("ukraine", "UA", 31.29, 49.19),
    ("moldova", "MD", 28.42, 47.20),
    ("russia", "RU", 95.79, 66.07),
    ("canada", "CA", -96.40, 60.48),
    ("mexico", "MX", -102.22, 23.91),
    ("guatemala", "GT", -90.37, 15.70),
    ("belize", "BZ", -88.70, 17.19),
    ("el salvador", "SV", -88.87, 13.73),
    ("honduras", "HN", -86.59, 14.83),
    ("nicaragua", "NI", -85.02, 12.85),
    ("costa rica", "CR", -84.17, 9.97),
    ("panama", "PA", -80.11, 8.53),
    ("cuba", "CU", -78.93, 21.65),
    ("haiti", "HT", -72.66, 18.90),
    ("dominican republic", "DO", -70.46, 18.89),
    ("jamaica", "JM", -77.32, 18.14),
    ("bahamas", "BS", -77.93, 25.51),
    ("trinidad and tobago", "TT", -61.33, 10.43),
    ("puerto rico", "PR", -66.48, 18.24),
    ("brazil", "BR", -53.17, -10.66),
    ("argentina", "AR", -64.75, -34.74),
    ("chile", "CL", -71.18, -37.31),
    ("colombia", "CO", -73.07, 3.92),
    ("venezuela", "VE", -66.15, 7.16),
    ("peru", "PE", -74.43, -9.15),
    ("ecuador", "EC", -78.38, -1.45),
    ("bolivia", "BO", -64.65, -16.70),
    ("paraguay", "PY", -58.43, -23.23),
    ("uruguay", "UY", -56.01, -32.77),
    ("guyana", "GY", -58.97, 4.79),
    ("suriname", "SR", -55.91, 4.12),
    ("falkland islands", "FK", -59.42, -51.72),
    ("falklands", "FK", -59.42, -51.72),
    ("morocco", "MA", -8.69, 29.82),
    ("algeria", "DZ", 2.61, 28.09),
    ("tunisia", "TN", 9.54, 34.14),
    ("libya", "LY", 18.03, 26.99),
    ("egypt", "EG", 29.86, 26.47),
    ("sudan", "SD", 29.83, 15.97),
    ("south sudan", "SS", 30.20, 7.29),
    ("western sahara", "EH", -12.19, 24.28),
    ("mauritania", "MR", -10.35, 20.18),
    ("mali", "ML", -3.59, 17.24),
    ("niger", "NE", 9.27, 17.34),
    ("chad", "TD", 18.57, 15.28),
    ("senegal", "SN", -14.51, 14.35),
    ("gambia", "GM", -15.43, 13.48),
    ("guinea-bissau", "GW", -15.11, 12.02),
    ("guinea", "GN", -11.06, 10.45),
    ("sierra leone", "SL", -11.80, 8.53),
    ("liberia", "LR", -9.41, 6.43),
    ("ivory coast", "CI", -5.61, 7.55),
    ("cote d ivoire", "CI", -5.61, 7.55),
    ("ghana", "GH", -1.24, 7.92),
    ("togo", "TG", 1.00, 8.43),
    ("benin", "BJ", 2.34, 9.64),
    ("burkina faso", "BF", -1.78, 12.31),
    ("nigeria", "NG", 7.99, 9.54),
    ("cameroon", "CM", 12.61, 5.65),
    ("central african republic", "CF", 20.37, 6.55),
    ("equatorial guinea", "GQ", 10.37, 1.65),
    ("gabon", "GA", 11.69, -0.65),
    ("republic of congo", "CG", 15.14, -0.84),
    ("congo-brazzaville", "CG", 15.14, -0.84),
    ("democratic republic of congo", "CD", 23.58, -2.84),
    ("dr congo", "CD", 23.58, -2.84),
    ("dr-congo", "CD", 23.58, -2.84),
    ("angola", "AO", 17.47, -12.23),
    ("ethiopia", "ET", 39.56, 8.65),
    ("eritrea", "ER", 38.69, 15.43),
    ("djibouti", "DJ", 42.50, 11.77),
    ("somalia", "SO", 45.70, 4.74),
    ("somaliland", "SO", 45.70, 4.74),
    ("kenya", "KE", 37.79, 0.60),
    ("uganda", "UG", 32.36, 1.30),
    ("rwanda", "RW", 29.92, -2.01),
    ("burundi", "BI", 29.91, -3.38),
    ("tanzania", "TZ", 34.74, -6.25),
    ("malawi", "MW", 34.19, -13.16),
    ("zambia", "ZM", 27.76, -13.39),
    ("zimbabwe", "ZW", 29.79, -18.90),
    ("mozambique", "MZ", 35.54, -17.15),
    ("madagascar", "MG", 46.73, -19.30),
    ("botswana", "BW", 23.78, -22.08),
    ("namibia", "NA", 17.14, -22.04),
    ("south africa", "ZA", 25.16, -28.92),
    ("lesotho", "LS", 28.17, -29.62),
    ("eswatini", "SZ", 31.40, -26.49),
    ("swaziland", "SZ", 31.40, -26.49),
    ("turkey", "TR", 35.12, 39.15),
    ("turkiye", "TR", 35.12, 39.15),
    ("cyprus", "CY", 33.04, 34.91),
    ("syria", "SY", 38.52, 35.01),
    ("lebanon", "LB", 35.87, 33.91),
    ("israel", "IL", 35.00, 31.48),
    ("palestine", "PS", 35.27, 31.94),
    ("gaza", "PS", 35.27, 31.94),
    ("west bank", "PS", 35.27, 31.94),
    ("jordan", "JO", 36.77, 31.24),
    ("iraq", "IQ", 43.79, 33.01),
    ("iran", "IR", 54.45, 32.47),
    ("saudi arabia", "SA", 44.64, 24.09),
    ("yemen", "YE", 47.52, 15.92),
    ("oman", "OM", 56.07, 20.59),
    ("united arab emirates", "AE", 54.20, 23.87),
    ("uae", "AE", 54.20, 23.87),
    ("qatar", "QA", 51.18, 25.32),
    ("kuwait", "KW", 47.60, 29.31),
    ("kazakhstan", "KZ", 67.24, 48.41),
    ("uzbekistan", "UZ", 63.37, 41.77),
    ("turkmenistan", "TM", 59.35, 39.10),
    ("kyrgyzstan", "KG", 74.59, 41.52),
    ("tajikistan", "TJ", 71.05, 38.59),
    ("afghanistan", "AF", 66.00, 33.84),
    ("pakistan", "PK", 69.23, 29.91),
    ("india", "IN", 79.54, 22.82),
    ("bangladesh", "BD", 90.28, 23.83),
    ("nepal", "NP", 84.04, 28.25),
    ("bhutan", "BT", 90.47, 27.43),
    ("sri lanka", "LK", 80.67, 7.70),
    ("china", "CN", 103.45, 36.68),
    ("taiwan", "TW", 120.97, 23.74),
    ("japan", "JP", 137.71, 37.54),
    ("south korea", "KR", 127.82, 36.42),
    ("north korea", "KP", 127.13, 40.13),
    ("mongolia", "MN", 103.02, 46.95),
    ("myanmar", "MM", 96.51, 20.94),
    ("burma", "MM", 96.51, 20.94),
    ("thailand", "TH", 101.00, 14.98),
    ("laos", "LA", 103.79, 18.43),
    ("cambodia", "KH", 104.87, 12.68),
    ("vietnam", "VN", 106.33, 16.56),
    ("malaysia", "MY", 109.70, 3.75),
    ("indonesia", "ID", 117.36, -2.27),
    ("philippines", "PH", 122.94, 11.72),
    ("brunei", "BN", 114.92, 4.69),
    ("timor-leste", "TL", 125.97, -8.77),
    ("east timor", "TL", 125.97, -8.77),
    ("australia", "AU", 134.31, -25.76),
    ("new zealand", "NZ", 172.95, -41.55),
    ("papua new guinea", "PG", 145.31, -6.46),
    ("fiji", "FJ", 178.57, -17.32),
    ("solomon islands", "SB", 159.96, -8.85),
    ("vanuatu", "VU", 167.07, -15.54),
    ("new caledonia", "NC", 165.53, -21.26),
    ("georgia", "GE", 43.50, 42.17),
    ("armenia", "AM", 45.01, 40.21),
    ("azerbaijan", "AZ", 47.56, 40.22),
    ("greenland", "GL", -41.96, 73.15),
    ("fr s antarctic lands", "TF", 69.53, -49.31),
];

/// (demonym/adjective, iso) → resolves to the country's centroid.
const DEMONYMS: &[(&str, &str)] = &[
    ("ukrainian", "UA"),
    ("russian", "RU"),
    ("american", "US"),
    ("british", "GB"),
    ("french", "FR"),
    ("german", "DE"),
    ("spanish", "ES"),
    ("italian", "IT"),
    ("japanese", "JP"),
    ("chinese", "CN"),
    ("indian", "IN"),
    ("canadian", "CA"),
    ("mexican", "MX"),
    ("brazilian", "BR"),
    ("argentine", "AR"),
    ("argentinian", "AR"),
    ("egyptian", "EG"),
    ("nigerian", "NG"),
    ("kenyan", "KE"),
    ("turkish", "TR"),
    ("iranian", "IR"),
    ("iraqi", "IQ"),
    ("saudi", "SA"),
    ("israeli", "IL"),
    ("palestinian", "PS"),
    ("lebanese", "LB"),
    ("syrian", "SY"),
    ("afghan", "AF"),
    ("pakistani", "PK"),
    ("thai", "TH"),
    ("indonesian", "ID"),
    ("filipino", "PH"),
    ("vietnamese", "VN"),
    ("australian", "AU"),
    ("polish", "PL"),
    ("dutch", "NL"),
    ("greek", "GR"),
    ("portuguese", "PT"),
    ("irish", "IE"),
    ("ethiopian", "ET"),
    ("sudanese", "SD"),
    ("yemeni", "YE"),
    ("venezuelan", "VE"),
    ("colombian", "CO"),
    ("chilean", "CL"),
];

/// Normalize text to a space-padded, lowercase, alphanumeric haystack so all
/// matches are whole-word (` name ` substring tests).
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push(' ');
    let mut last_space = true;
    for c in text.chars() {
        let lc = c.to_ascii_lowercase();
        // Keep ascii alphanumerics and any non-ascii letter (é, ã, etc.);
        // everything else becomes a single space.
        if lc.is_ascii_alphanumeric() || (!c.is_ascii() && c.is_alphabetic()) {
            out.push(lc);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    if !out.ends_with(' ') {
        out.push(' ');
    }
    out
}

/// Centroid for an ISO code (from the COUNTRIES table); used by demonym resolution.
fn centroid_for_iso(iso: &str) -> Option<LonLat> {
    COUNTRIES
        .iter()
        .find(|(_, code, _, _)| *code == iso)
        .map(|(_, _, lon, lat)| (*lon, *lat))
}

/// Resolve a country centroid from an ISO-3166 alpha-2 code (case-insensitive).
/// Returns the `&'static str` iso from the matched COUNTRIES tuple so the
/// lifetime is `'static`. Deliberately returns `None` for non-country macro
/// tokens like "AFRICA"/"MENA"/"GLOBAL" since they aren't in COUNTRIES.
pub fn geo_for_iso(iso: &str) -> Option<Geo> {
    let up = iso.to_ascii_uppercase();
    COUNTRIES
        .iter()
        .find(|(_, code, _, _)| code.eq_ignore_ascii_case(&up))
        .map(|(_, code, lon, lat)| Geo {
            iso_a2: code,
            lon: *lon,
            lat: *lat,
        })
}

/// Resolve the best geocode from text. Cities first (longest match wins for
/// disambiguation), then country names, then demonyms.
pub fn resolve(text: &str) -> Option<Geo> {
    let hay = normalize(text);

    // Cities — track the longest matching name to disambiguate overlaps.
    let mut best: Option<(usize, Geo)> = None;
    for (name, iso, lon, lat) in CITIES {
        if hay.contains(&format!(" {name} ")) {
            let len = name.len();
            if best.map(|(l, _)| len > l).unwrap_or(true) {
                best = Some((
                    len,
                    Geo {
                        iso_a2: iso,
                        lon: *lon,
                        lat: *lat,
                    },
                ));
            }
        }
    }
    if let Some((_, geo)) = best {
        return Some(geo);
    }

    // Country names — longest match wins.
    let mut best: Option<(usize, Geo)> = None;
    for (name, iso, lon, lat) in COUNTRIES {
        if hay.contains(&format!(" {name} ")) {
            let len = name.len();
            if best.map(|(l, _)| len > l).unwrap_or(true) {
                best = Some((
                    len,
                    Geo {
                        iso_a2: iso,
                        lon: *lon,
                        lat: *lat,
                    },
                ));
            }
        }
    }
    if let Some((_, geo)) = best {
        return Some(geo);
    }

    // Demonyms.
    for (word, iso) in DEMONYMS {
        if hay.contains(&format!(" {word} ")) {
            if let Some((lon, lat)) = centroid_for_iso(iso) {
                return Some(Geo {
                    iso_a2: iso,
                    lon,
                    lat,
                });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iso(text: &str) -> Option<&'static str> {
        resolve(text).map(|g| g.iso_a2)
    }

    #[test]
    fn resolves_required_cities() {
        assert_eq!(iso("Kyiv reports overnight drone interception"), Some("UA"));
        assert_eq!(iso("Moderate earthquake recorded off Tokyo"), Some("JP"));
    }

    #[test]
    fn resolves_multiword_cities() {
        assert_eq!(
            iso("Protests continue in São Paulo over fuel prices"),
            Some("BR")
        );
        assert_eq!(iso("Heatwave grips New York this week"), Some("US"));
    }

    #[test]
    fn resolves_country_names() {
        assert_eq!(
            iso("Reports from Kenya describe widening drought"),
            Some("KE")
        );
        assert_eq!(iso("Markets in Japan rally"), Some("JP"));
    }

    #[test]
    fn resolves_demonyms() {
        assert_eq!(iso("Brazilian economy shows surprise growth"), Some("BR"));
        assert_eq!(iso("Iranian officials confirm the strike"), Some("IR"));
    }

    #[test]
    fn word_boundary_prevents_false_positive() {
        // "iran" must not match inside "iranian" as a *country* (would still be
        // IR via demonym, which is correct) — but "india" must not match "indian".
        assert_eq!(iso("An Indian delegation arrived"), Some("IN")); // demonym
                                                                     // A word containing a country substring but unrelated should not match.
        assert_eq!(iso("The chinaware shop opened"), None); // "china" not whole-word
    }

    #[test]
    fn returns_none_when_unlocated() {
        assert_eq!(resolve("Council approves new park bench"), None);
        assert_eq!(resolve(""), None);
    }

    #[test]
    fn city_beats_country_specificity() {
        // Kyiv (city) resolves even though "Ukraine" not present; centroid is the city's.
        let g = resolve("Explosions reported across Kyiv overnight").unwrap();
        assert_eq!(g.iso_a2, "UA");
        assert!((g.lat - 50.45).abs() < 0.01);
    }

    #[test]
    fn geo_for_iso_resolves_country_and_rejects_macro_tokens() {
        assert_eq!(geo_for_iso("MR").map(|g| g.iso_a2), Some("MR"));
        assert_eq!(geo_for_iso("mr").map(|g| g.iso_a2), Some("MR")); // case-insensitive
        assert_eq!(geo_for_iso("AFRICA"), None); // macro region, not a country
        assert_eq!(geo_for_iso("ZZ"), None); // not a real iso
    }
}
