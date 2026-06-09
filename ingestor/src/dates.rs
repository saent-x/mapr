//! Minimal, dependency-free date parsing → ms epoch (UTC).
//!
//! Handles the three formats the fetchers encounter: GDELT compact
//! (`YYYYMMDDTHHMMSSZ`), RFC-3339 (Atom), and RFC-2822 (RSS `pubDate`).
//! Returns `None` on anything unrecognized so callers can substitute `now`.

/// Days since the Unix epoch for a civil (proleptic Gregorian) date.
/// Howard Hinnant's `days_from_civil` algorithm.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

fn to_epoch_ms(y: i64, mo: i64, d: i64, h: i64, mi: i64, s: i64) -> i64 {
    (days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + s) * 1_000
}

fn month_from_name(name: &str) -> Option<i64> {
    Some(match &name.to_ascii_lowercase()[..name.len().min(3)] {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    })
}

/// GDELT `seendate`: `YYYYMMDDTHHMMSSZ`.
pub fn parse_gdelt(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 15 || b[8] != b'T' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| s.get(range)?.parse::<i64>().ok();
    Some(to_epoch_ms(
        num(0..4)?,
        num(4..6)?,
        num(6..8)?,
        num(9..11)?,
        num(11..13)?,
        num(13..15)?,
    ))
}

/// RFC-3339 / ISO-8601: `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`.
/// Timezone offset is applied; missing offset is treated as UTC.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, rest) = s.split_once(['T', 't', ' '])?;
    let mut dparts = date.split('-');
    let y: i64 = dparts.next()?.parse().ok()?;
    let mo: i64 = dparts.next()?.parse().ok()?;
    let d: i64 = dparts.next()?.parse().ok()?;

    // Split off timezone.
    let (time, tz_sign, tz): (&str, i64, &str) = if let Some(t) = rest.strip_suffix(['Z', 'z']) {
        (t, 0, "")
    } else if let Some(idx) = rest.rfind('+') {
        (&rest[..idx], -1, &rest[idx + 1..])
    } else if let Some(idx) = rest[1..].rfind('-') {
        (&rest[..idx + 1], 1, &rest[idx + 2..])
    } else {
        (rest, 0, "")
    };

    let time = time.split('.').next().unwrap_or(time);
    let mut tparts = time.split(':');
    let h: i64 = tparts.next()?.parse().ok()?;
    let mi: i64 = tparts.next().unwrap_or("0").parse().ok()?;
    let sec: i64 = tparts.next().unwrap_or("0").parse().ok()?;

    let mut epoch = to_epoch_ms(y, mo, d, h, mi, sec);
    if !tz.is_empty() {
        let mut tzp = tz.split(':');
        let th: i64 = tzp.next().unwrap_or("0").parse().unwrap_or(0);
        let tm: i64 = tzp.next().unwrap_or("0").parse().unwrap_or(0);
        epoch += tz_sign * (th * 3_600 + tm * 60) * 1_000;
    }
    Some(epoch)
}

/// RFC-2822 RSS `pubDate`: `[Day,] DD Mon YYYY HH:MM:SS [TZ]`.
/// Numeric offsets are applied; named zones other than GMT/UT/Z are treated as UTC.
pub fn parse_rfc2822(s: &str) -> Option<i64> {
    let s = s.trim();
    let rest = match s.split_once(", ") {
        Some((_, r)) => r,
        None => s,
    };
    let toks: Vec<&str> = rest.split_whitespace().collect();
    if toks.len() < 4 {
        return None;
    }
    let d: i64 = toks[0].parse().ok()?;
    let mo = month_from_name(toks[1])?;
    let y: i64 = {
        let raw: i64 = toks[2].parse().ok()?;
        if raw < 100 {
            if raw < 70 {
                raw + 2000
            } else {
                raw + 1900
            }
        } else {
            raw
        }
    };
    let mut tparts = toks[3].split(':');
    let h: i64 = tparts.next()?.parse().ok()?;
    let mi: i64 = tparts.next().unwrap_or("0").parse().ok()?;
    let sec: i64 = tparts.next().unwrap_or("0").parse().ok()?;

    let mut epoch = to_epoch_ms(y, mo, d, h, mi, sec);
    if let Some(tz) = toks.get(4) {
        if let Some(off) = tz
            .strip_prefix('+')
            .map(|v| (1i64, v))
            .or_else(|| tz.strip_prefix('-').map(|v| (-1i64, v)))
        {
            let (sign, digits) = off;
            if digits.len() >= 4 {
                let th: i64 = digits[..2].parse().unwrap_or(0);
                let tm: i64 = digits[2..4].parse().unwrap_or(0);
                epoch -= sign * (th * 3_600 + tm * 60) * 1_000;
            }
        }
    }
    Some(epoch)
}

/// Try all known formats; returns `None` if none parse.
pub fn parse_any(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    parse_gdelt(s)
        .or_else(|| parse_rfc3339(s))
        .or_else(|| parse_rfc2822(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2024-01-31T12:00:00Z == 1706702400 s.
    const REF: i64 = 1_706_702_400_000;

    #[test]
    fn epoch_anchor() {
        assert_eq!(to_epoch_ms(1970, 1, 1, 0, 0, 0), 0);
        assert_eq!(to_epoch_ms(2024, 1, 31, 12, 0, 0), REF);
    }

    #[test]
    fn gdelt_format() {
        assert_eq!(parse_gdelt("20240131T120000Z"), Some(REF));
        assert_eq!(parse_gdelt("bad"), None);
    }

    #[test]
    fn rfc3339_utc_and_offset() {
        assert_eq!(parse_rfc3339("2024-01-31T12:00:00Z"), Some(REF));
        assert_eq!(parse_rfc3339("2024-01-31T12:00:00.500Z"), Some(REF));
        // +02:00 means local is 14:00 → UTC 12:00.
        assert_eq!(parse_rfc3339("2024-01-31T14:00:00+02:00"), Some(REF));
        // -05:00 means local 07:00 → UTC 12:00.
        assert_eq!(parse_rfc3339("2024-01-31T07:00:00-05:00"), Some(REF));
    }

    #[test]
    fn rfc2822_gmt_and_offset() {
        assert_eq!(parse_rfc2822("Wed, 31 Jan 2024 12:00:00 GMT"), Some(REF));
        assert_eq!(parse_rfc2822("31 Jan 2024 12:00:00 +0000"), Some(REF));
        // +0200 local 14:00 → UTC 12:00.
        assert_eq!(parse_rfc2822("Wed, 31 Jan 2024 14:00:00 +0200"), Some(REF));
    }

    #[test]
    fn parse_any_dispatches() {
        assert_eq!(parse_any("20240131T120000Z"), Some(REF));
        assert_eq!(parse_any("2024-01-31T12:00:00Z"), Some(REF));
        assert_eq!(parse_any("Wed, 31 Jan 2024 12:00:00 GMT"), Some(REF));
        assert_eq!(parse_any(""), None);
        assert_eq!(parse_any("not a date"), None);
    }
}
