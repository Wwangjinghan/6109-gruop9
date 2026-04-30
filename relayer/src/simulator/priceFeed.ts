// ─── Price feed abstraction ───────────────────────────────────────────────────

export interface PricePoint {
  asset: string;      // e.g. "ethereum"
  priceUsd: number;
  fetchedAt: number;  // Unix ms
}

export interface PriceFeed {
  getPrice(asset: string): Promise<PricePoint>;
  close?(): void;
}

// ─── CoinGecko implementation ─────────────────────────────────────────────────

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export interface CoinGeckoConfig {
  /** Optional Pro API key — adds x-cg-pro-api-key header and uses pro base URL */
  apiKey?: string;
  /** Request timeout in ms (default 10 000) */
  timeoutMs?: number;
}

export class CoinGeckoPriceFeed implements PriceFeed {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: CoinGeckoConfig = {}) {
    this.baseUrl = config.apiKey
      ? "https://pro-api.coingecko.com/api/v3"
      : COINGECKO_BASE;
    this.headers = config.apiKey
      ? { "x-cg-pro-api-key": config.apiKey }
      : {};
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async getPrice(asset: string): Promise<PricePoint> {
    const url = `${this.baseUrl}/simple/price?ids=${encodeURIComponent(asset)}&vs_currencies=usd`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url, { headers: this.headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(`CoinGecko error ${resp.status}: ${await resp.text()}`);
    }

    const json = await resp.json() as Record<string, { usd?: number }>;
    const priceUsd = json[asset]?.usd;

    if (priceUsd === undefined) {
      throw new Error(`CoinGecko: no USD price for asset "${asset}"`);
    }

    return { asset, priceUsd, fetchedAt: Date.now() };
  }
}

// ─── Mock implementation (dev / test) ────────────────────────────────────────

export interface MockPriceFeedConfig {
  /**
   * Initial price map.  Key = asset ID (e.g. "ethereum"), value = USD price.
   */
  prices: Record<string, number>;
  /**
   * Optional: automatically drift prices on each call.
   * Positive = upward drift per call (%), negative = downward.
   */
  driftPercent?: number;
}

/**
 * Deterministic price feed for local development and unit tests.
 * Prices start at the configured values and drift linearly on each getPrice() call.
 */
export class MockPriceFeed implements PriceFeed {
  private prices: Record<string, number>;
  private readonly driftPercent: number;
  private readonly callCount: Record<string, number> = {};

  constructor(config: MockPriceFeedConfig) {
    this.prices = { ...config.prices };
    this.driftPercent = config.driftPercent ?? 0;
  }

  getPrice(asset: string): Promise<PricePoint> {
    if (!(asset in this.prices)) {
      return Promise.reject(new Error(`MockPriceFeed: unknown asset "${asset}"`));
    }

    this.callCount[asset] = (this.callCount[asset] ?? 0) + 1;

    if (this.driftPercent !== 0) {
      this.prices[asset] = this.prices[asset] * (1 + this.driftPercent / 100);
    }

    return Promise.resolve({
      asset,
      priceUsd: this.prices[asset],
      fetchedAt: Date.now(),
    });
  }

  /** Manually set a price (useful in tests to trigger conditions). */
  setPrice(asset: string, priceUsd: number): void {
    this.prices[asset] = priceUsd;
  }

  getCallCount(asset: string): number {
    return this.callCount[asset] ?? 0;
  }
}
