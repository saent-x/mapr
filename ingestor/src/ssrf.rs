//! SSRF guard — a faithful Rust port of `server/urlGuard.js`.
//!
//! Prevents the worker from fetching attacker-controlled URLs that resolve to
//! internal infrastructure. Two layers:
//!   1. [`is_public_http_url`] — pure string/IP-literal check (scheme + host).
//!   2. [`assert_public_host`] — resolves the host via DNS and re-checks every
//!      returned IP (defends against DNS-rebinding).
//!
//! Blocks: non-http(s) schemes; loopback (127/8, ::1); link-local
//! (169.254/16 incl. cloud metadata, fe80::/10); RFC1918 (10/8, 172.16/12,
//! 192.168/16); multicast/reserved (224/4, 240/4); unique-local IPv6 (fc00::/7);
//! IPv4-mapped IPv6 (re-checks embedded v4); and the hostnames
//! localhost / *.local / *.internal / metadata.google.internal.
//!
//! NOTE (matches the JS source): this does check-then-connect and does not pin
//! the validated IP into the subsequent socket, so a fast TTL flip between the
//! check and the connect could still rebind. Adequate for the pipeline; full
//! mitigation would require a custom connector that returns the validated IP.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

/// Reason a URL was rejected. Carried in errors / logs.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SsrfError {
    #[error("invalid or private url")]
    InvalidOrPrivate,
    #[error("url parse error")]
    ParseError,
    #[error("dns lookup failed")]
    DnsLookupFailed,
    #[error("no dns records")]
    NoDnsRecords,
    #[error("resolved to private ipv4: {0}")]
    PrivateIpv4(Ipv4Addr),
    #[error("resolved to private ipv6: {0}")]
    PrivateIpv6(Ipv6Addr),
}

const BLOCKED_HOSTNAMES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
];

/// True if `ip` falls in any blocked IPv4 range.
fn is_private_or_reserved_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    in_cidr_v4(o, [0, 0, 0, 0], 8)      // 0.0.0.0/8  ("this network")
        || in_cidr_v4(o, [10, 0, 0, 0], 8)        // RFC1918
        || in_cidr_v4(o, [127, 0, 0, 0], 8)       // loopback
        || in_cidr_v4(o, [169, 254, 0, 0], 16)    // link-local + metadata
        || in_cidr_v4(o, [172, 16, 0, 0], 12)     // RFC1918
        || in_cidr_v4(o, [192, 168, 0, 0], 16)    // RFC1918
        || in_cidr_v4(o, [224, 0, 0, 0], 4)       // multicast
        || in_cidr_v4(o, [240, 0, 0, 0], 4) // reserved
}

fn in_cidr_v4(ip: [u8; 4], base: [u8; 4], bits: u32) -> bool {
    if bits == 0 {
        return true;
    }
    let ip_n = u32::from_be_bytes(ip);
    let base_n = u32::from_be_bytes(base);
    let mask: u32 = if bits >= 32 {
        u32::MAX
    } else {
        !0u32 << (32 - bits)
    };
    (ip_n & mask) == (base_n & mask)
}

/// True if `ip` falls in any blocked IPv6 range (incl. IPv4-mapped re-check).
fn is_private_or_reserved_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_unspecified() || ip == Ipv6Addr::LOCALHOST {
        return true; // :: and ::1
    }
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_private_or_reserved_ipv4(v4);
    }
    let seg0 = ip.segments()[0];
    // Link-local fe80::/10
    if (seg0 & 0xffc0) == 0xfe80 {
        return true;
    }
    // Unique-local fc00::/7
    if (seg0 & 0xfe00) == 0xfc00 {
        return true;
    }
    false
}

/// Returns true iff `value` parses as an http(s) URL whose host is a public
/// hostname or public IP literal. Returns false on anything suspicious.
pub fn is_public_http_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    match url.scheme() {
        "http" | "https" => {}
        _ => return false,
    }
    let Some(host) = url.host() else {
        return false;
    };
    match host {
        Host::Ipv4(ip) => !is_private_or_reserved_ipv4(ip),
        Host::Ipv6(ip) => !is_private_or_reserved_ipv6(ip),
        Host::Domain(domain) => {
            let host = domain.to_ascii_lowercase();
            if host.is_empty() || BLOCKED_HOSTNAMES.contains(&host.as_str()) {
                return false;
            }
            if host.ends_with(".local") || host.ends_with(".internal") {
                return false;
            }
            true
        }
    }
}

/// Resolve `value`'s host via DNS and verify every returned IP is public.
/// Defends against DNS-rebinding even when the hostname looks public.
pub async fn assert_public_host(value: &str) -> Result<Vec<IpAddr>, SsrfError> {
    if !is_public_http_url(value) {
        return Err(SsrfError::InvalidOrPrivate);
    }
    let url = Url::parse(value).map_err(|_| SsrfError::ParseError)?;
    let host = url.host().ok_or(SsrfError::ParseError)?;

    // IP-literal hosts are already validated by `is_public_http_url`.
    match host {
        Host::Ipv4(ip) => return Ok(vec![IpAddr::V4(ip)]),
        Host::Ipv6(ip) => return Ok(vec![IpAddr::V6(ip)]),
        Host::Domain(_) => {}
    }

    let host_str = match host {
        Host::Domain(d) => d.to_string(),
        _ => unreachable!(),
    };
    // Port is required by lookup_host; the value is irrelevant to A/AAAA records.
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = tokio::net::lookup_host((host_str.as_str(), port))
        .await
        .map_err(|_| SsrfError::DnsLookupFailed)?;

    let ips: Vec<IpAddr> = addrs.map(|sa| sa.ip()).collect();
    if ips.is_empty() {
        return Err(SsrfError::NoDnsRecords);
    }
    for ip in &ips {
        match ip {
            IpAddr::V4(v4) if is_private_or_reserved_ipv4(*v4) => {
                return Err(SsrfError::PrivateIpv4(*v4))
            }
            IpAddr::V6(v6) if is_private_or_reserved_ipv6(*v6) => {
                return Err(SsrfError::PrivateIpv6(*v6))
            }
            _ => {}
        }
    }
    Ok(ips)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        for u in [
            "file:///etc/passwd",
            "ftp://example.com/x",
            "gopher://example.com",
            "ssh://example.com",
            "ws://example.com",
            "javascript:alert(1)",
        ] {
            assert!(!is_public_http_url(u), "{u} should be rejected");
        }
    }

    #[test]
    fn rejects_loopback_ipv4() {
        assert!(!is_public_http_url("http://127.0.0.1/"));
        assert!(!is_public_http_url("http://127.1.2.3/"));
    }

    #[test]
    fn rejects_rfc1918() {
        assert!(!is_public_http_url("http://10.0.0.1/"));
        assert!(!is_public_http_url("http://10.255.255.255/"));
        assert!(!is_public_http_url("http://172.16.0.1/"));
        assert!(!is_public_http_url("http://172.31.255.255/"));
        assert!(!is_public_http_url("http://192.168.1.1/"));
        // 172.15 and 172.32 are PUBLIC (outside the /12).
        assert!(is_public_http_url("http://172.15.0.1/"));
        assert!(is_public_http_url("http://172.32.0.1/"));
    }

    #[test]
    fn rejects_link_local_and_metadata() {
        assert!(!is_public_http_url("http://169.254.0.1/"));
        assert!(!is_public_http_url("http://169.254.169.254/")); // cloud metadata
    }

    #[test]
    fn rejects_multicast_and_reserved() {
        assert!(!is_public_http_url("http://224.0.0.1/"));
        assert!(!is_public_http_url("http://239.255.255.255/"));
        assert!(!is_public_http_url("http://240.0.0.1/"));
        assert!(!is_public_http_url("http://255.255.255.255/"));
        assert!(!is_public_http_url("http://0.0.0.0/"));
    }

    #[test]
    fn rejects_ipv6_loopback_and_ula_and_linklocal() {
        assert!(!is_public_http_url("http://[::1]/"));
        assert!(!is_public_http_url("http://[::]/"));
        assert!(!is_public_http_url("http://[fe80::1]/"));
        assert!(!is_public_http_url("http://[fc00::1]/"));
        assert!(!is_public_http_url("http://[fd12:3456::1]/"));
    }

    #[test]
    fn rejects_ipv4_mapped_ipv6_private() {
        // ::ffff:127.0.0.1 and ::ffff:10.0.0.1
        assert!(!is_public_http_url("http://[::ffff:127.0.0.1]/"));
        assert!(!is_public_http_url("http://[::ffff:10.0.0.1]/"));
        assert!(!is_public_http_url("http://[::ffff:7f00:1]/")); // hex form of 127.0.0.1
    }

    #[test]
    fn rejects_internal_hostnames() {
        assert!(!is_public_http_url("http://localhost/"));
        assert!(!is_public_http_url("https://localhost.localdomain/"));
        assert!(!is_public_http_url("http://metadata.google.internal/"));
        assert!(!is_public_http_url("http://foo.local/"));
        assert!(!is_public_http_url("http://service.internal/"));
        assert!(!is_public_http_url("http://LOCALHOST/")); // case-insensitive
    }

    #[test]
    fn allows_public_hosts() {
        assert!(is_public_http_url(
            "https://api.gdeltproject.org/api/v2/doc/doc"
        ));
        assert!(is_public_http_url(
            "https://feeds.bbci.co.uk/news/world/rss.xml"
        ));
        assert!(is_public_http_url("http://example.com/path?query=1"));
        assert!(is_public_http_url("https://8.8.8.8/")); // public IP literal
        assert!(is_public_http_url("https://[2606:4700:4700::1111]/")); // public v6 literal
    }

    #[test]
    fn empty_and_garbage_rejected() {
        assert!(!is_public_http_url(""));
        assert!(!is_public_http_url("not a url"));
        assert!(!is_public_http_url("http://"));
    }

    #[tokio::test]
    async fn assert_public_host_blocks_ip_literal_loopback() {
        let err = assert_public_host("http://127.0.0.1/").await.unwrap_err();
        assert_eq!(err, SsrfError::InvalidOrPrivate);
    }

    #[tokio::test]
    async fn assert_public_host_returns_ip_for_public_literal() {
        let ips = assert_public_host("https://8.8.8.8/").await.unwrap();
        assert_eq!(ips, vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))]);
    }
}
