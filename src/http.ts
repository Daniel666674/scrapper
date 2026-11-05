export const USER_AGENT = "ScrapperFotos/1.0 (proveedor autorizado; uso interno)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Descarga con reintentos y pausa entre peticiones al mismo sitio. */
export class Client {
  private last = 0;
  private robots = new Map<string, string[]>();
  constructor(private delayMs: number, private respectRobots: boolean) {}

  private async wait() {
    const gap = this.last + this.delayMs - Date.now();
    if (gap > 0) await sleep(gap);
    this.last = Date.now();
  }

  async get(url: string, tries = 3): Promise<Response> {
    for (let i = 1; ; i++) {
      await this.wait();
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

  /** Revisa robots.txt (reglas Disallow para User-agent: *). */
  async allowed(url: string): Promise<boolean> {
    if (!this.respectRobots) return true;
    const u = new URL(url);
    if (!this.robots.has(u.origin)) {
      const rules: string[] = [];
      try {
        const res = await this.get(u.origin + "/robots.txt", 1);
        if (res.ok) {
          let applies = false;
          for (const raw of (await res.text()).split(/\r?\n/)) {
            const line = raw.split("#")[0].trim();
            const [k, ...v] = line.split(":");
            const val = v.join(":").trim();
            if (/^user-agent$/i.test(k)) applies = val === "*";
            else if (applies && /^disallow$/i.test(k) && val) rules.push(val);
          }
        }
      } catch { /* sin robots.txt: se permite */ }
      this.robots.set(u.origin, rules);
    }
    return !this.robots.get(u.origin)!.some((r) => (u.pathname + u.search).startsWith(r));
  }
}
