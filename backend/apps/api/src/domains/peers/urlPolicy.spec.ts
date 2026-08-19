import { checkEgressUrl, isEgressUrlAllowed } from './urlPolicy';

describe('checkEgressUrl', () => {
  it('allows an ordinary public https endpoint', () => {
    expect(checkEgressUrl('https://devon.example.com/agent/v1/ask')).toEqual({ ok: true });
    expect(checkEgressUrl('https://devon.example.com:443/agent/v1/ask').ok).toBe(true);
  });

  it('requires https — http would expose the token in transit', () => {
    expect(checkEgressUrl('http://devon.example.com/ask').ok).toBe(false);
  });

  it('refuses non-https schemes outright', () => {
    for (const url of ['file:///etc/passwd', 'ftp://host/x', 'gopher://host/x']) {
      expect(checkEgressUrl(url).ok).toBe(false);
    }
  });

  it('refuses embedded credentials', () => {
    expect(checkEgressUrl('https://user:pw@example.com/ask').ok).toBe(false);
  });

  it('refuses non-standard ports (an internal service scan)', () => {
    for (const port of [22, 5432, 6379, 8080, 9200]) {
      expect(checkEgressUrl(`https://example.com:${port}/ask`).ok).toBe(false);
    }
  });

  describe('SSRF address ranges', () => {
    it('refuses loopback', () => {
      for (const host of ['127.0.0.1', '127.1.2.3', '[::1]']) {
        expect(isEgressUrlAllowed(`https://${host}/ask`)).toBe(false);
      }
    });

    it('refuses cloud metadata (169.254.169.254)', () => {
      expect(isEgressUrlAllowed('https://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('refuses RFC1918 private space', () => {
      for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
        expect(isEgressUrlAllowed(`https://${host}/ask`)).toBe(false);
      }
    });

    it('refuses CGNAT, benchmarking, multicast and "this network"', () => {
      for (const host of ['100.64.0.1', '198.18.0.1', '224.0.0.1', '0.0.0.0']) {
        expect(isEgressUrlAllowed(`https://${host}/ask`)).toBe(false);
      }
    });

    it('refuses IPv6 unique-local and link-local', () => {
      for (const host of ['[fc00::1]', '[fd12:3456::1]', '[fe80::1]']) {
        expect(isEgressUrlAllowed(`https://${host}/ask`)).toBe(false);
      }
    });

    it('refuses IPv4-mapped IPv6 that smuggles a private address', () => {
      expect(isEgressUrlAllowed('https://[::ffff:10.0.0.1]/ask')).toBe(false);
      expect(isEgressUrlAllowed('https://[::ffff:127.0.0.1]/ask')).toBe(false);
    });

    it('refuses local hostnames', () => {
      for (const host of ['localhost', 'db.localhost', 'printer.local']) {
        expect(isEgressUrlAllowed(`https://${host}/ask`)).toBe(false);
      }
    });

    it('still allows a public address that merely looks similar', () => {
      // 172.32.x is OUTSIDE RFC1918 (which ends at 172.31), 11.x is public.
      expect(isEgressUrlAllowed('https://172.32.0.1/ask')).toBe(true);
      expect(isEgressUrlAllowed('https://11.0.0.1/ask')).toBe(true);
    });
  });

  it('reports a reason rather than throwing, so callers can decline gracefully', () => {
    const result = checkEgressUrl('http://10.0.0.1/ask');
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(checkEgressUrl('not a url').ok).toBe(false);
  });
});
