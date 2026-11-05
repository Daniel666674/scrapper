export const USER_AGENT = "ScrapperFotos/1.0 (authorized supplier; internal use)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bare = (host: string) => host.replace(/^www\./, "");

/**
 * Downloads with retries. Requests to the same site are spaced out (polite);
 * different hosts (e.g. an image CDN) are paced separately and faster.
 */
export class Client {
  private chains = new Map<string, Promise<void>>();
  private last = new Map<string, number>();
  private robots = new Map<string, string[]>();
  constructor(private delayMs: number, private respectRobots: boolean, private primaryHost?: string) {}

  private wait(host: string): Promise<void> {
    const other = this.primaryHost && bare(host) !== bare(this.primaryHost);
    const delay = other ? Math.min(this.delayMs, 250) : this.delayMs;
    const prev = this.chains.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const gap = (this.last.get(host) ?? 0) + delay - Date.now();
      if (gap > 0) await sleep(gap);
      this.last.set(host, Date.now());
    });
    this.chains.set(host, next);
    return next;
  }

  async get(url: string, tries = 3): Promise<Response> {
    for (let i = 1; ; i++) {
      await this.wait(new URL(url).host);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "*/*", Referer: new URL(url).origin + "/" },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (e) {
        if (i >= tries) throw e;
        await sleep(1000 * 2 ** i);
      }
    }
  }

  private async loadRobots(origin: string): Promise<{ disallow: string[]; sitemaps: string[] }> {
    const disallow: string[] = [];
    const sitemaps: string[] = [];
    try {
      const res = await this.get(origin + "/robots.txt", 1);
      if (res.ok) {
        let applies = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = raw.split("#")[0].trim();
          const [k, ...v] = line.split(":");
          const val = v.join(":").trim();
          if (/^user-agent$/i.test(k)) applies = val === "*";
          else if (/^sitemap$/i.test(k) && val) sitemaps.push(val);
          else if (applies && /^disallow$/i.test(k) && val) disallow.push(val);
        }
      }
    } catch { /* no robots.txt: everything allowed */ }
    this.robots.set(origin, disallow);
    this.sitemapCache.set(origin, sitemaps);
    return { disallow, sitemaps };
  }
  private sitemapCache = new Map<string, string[]>();

  /** Sitemap URLs declared in robots.txt */
  async sitemapsOf(origin: string): Promise<string[]> {
    if (!this.sitemapCache.has(origin)) await this.loadRobots(origin);
    return this.sitemapCache.get(origin)!;
  }

  async allowed(url: string): Promise<boolean> {
    if (!this.respectRobots) return true;
    const u = new URL(url);
    if (!this.robots.has(u.origin)) await this.loadRobots(u.origin);
    return !this.robots.get(u.origin)!.some((r) => (u.pathname + u.search).startsWith(r));
  }
}
