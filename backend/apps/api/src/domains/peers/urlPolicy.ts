/**
 * Egress policy for peer + directory URLs.
 *
 * `memoryEndpoint` and `directoryUrl` are attacker-influenced: a peer descriptor
 * comes from the Portal directory, and a peer link stores whatever endpoint that
 * descriptor carried. Fetching them server-side is a textbook SSRF sink — a
 * hostile or compromised directory entry pointing at `http://169.254.169.254/`
 * or `http://localhost:5432/` would have this box make the request on the
 * attacker's behalf, from inside the appliance's own network.
 *
 * The policy is deliberately an allowlist of *shapes*, not a blocklist of
 * strings: https only, no credentials, no non-standard ports, and no address
 * that resolves to a private, loopback, link-local, or otherwise special range.
 *
 * NOTE ON DNS REBINDING: this validates the literal host. A hostname that
 * resolves to a private address at connect time is not caught here — closing
 * that requires pinning the resolved IP through the socket, which Node's fetch
 * does not expose. The remaining exposure is bounded by requiring https (so the
 * peer must present a valid certificate for the name) and is recorded as a known
 * limitation rather than silently assumed away.
 */

/** Ports a legitimate peer or directory may listen on. */
const ALLOWED_PORTS: ReadonlySet<string> = new Set(['', '443']);

export interface UrlPolicyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Whether a literal IPv4 string falls in a range that must never be fetched.
 * Covers RFC1918 private space, loopback, link-local (incl. cloud metadata at
 * 169.254.169.254), CGNAT, benchmarking, multicast, and reserved.
 */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;

  return (
    a === 0 || // "this" network
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

/** Whether an IPv6 literal (already stripped of brackets) must never be fetched. */
function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized === '::1' || normalized === '::' || normalized === '0:0:0:0:0:0:0:1') {
    return true; // loopback / unspecified
  }

  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) {
    return true;
  }

  // IPv4-mapped addresses embed a v4 address inside a v6 one, and must be
  // re-checked against the v4 rules or `::ffff:10.0.0.1` becomes a bypass.
  //
  // Two spellings reach us: the dotted form a caller types, and the HEX form
  // `URL` normalizes it to (`::ffff:a00:1`). Only handling the dotted one leaves
  // the bypass wide open, because by the time the host reaches this function
  // WHATWG URL parsing has already rewritten it to hex.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (dotted) {
    return isBlockedIpv4(dotted[1]);
  }

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');

    return isBlockedIpv4(ipv4);
  }

  return false;
}

/**
 * Validate a URL this box is about to fetch server-side.
 *
 * Returns a reason rather than throwing so callers can log and degrade — a bad
 * peer endpoint should decline the ask, never crash the request.
 */
export function checkEgressUrl(raw: string): UrlPolicyResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'must use https' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'must not embed credentials' };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `port ${url.port} is not permitted` };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, reason: 'must not target a local hostname' };
  }

  if (host.includes(':') || host.startsWith('[')) {
    return isBlockedIpv6(host)
      ? { ok: false, reason: 'must not target a private or loopback address' }
      : { ok: true };
  }

  if (isBlockedIpv4(host)) {
    return { ok: false, reason: 'must not target a private or loopback address' };
  }

  return { ok: true };
}

/** Convenience predicate for call sites that only need a boolean. */
export function isEgressUrlAllowed(raw: string): boolean {
  return checkEgressUrl(raw).ok;
}
