import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockPriceFeed, CoinGeckoPriceFeed } from "./priceFeed.js";

describe("MockPriceFeed", () => {
  it("returns the configured price", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000 } });
    const point = await feed.getPrice("ethereum");
    expect(point.asset).toBe("ethereum");
    expect(point.priceUsd).toBe(2000);
    expect(point.fetchedAt).toBeGreaterThan(0);
  });

  it("rejects unknown assets", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000 } });
    await expect(feed.getPrice("bitcoin")).rejects.toThrow("unknown asset");
  });

  it("applies negative drift on each call", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000 }, driftPercent: -10 });
    const p1 = await feed.getPrice("ethereum");
    const p2 = await feed.getPrice("ethereum");
    expect(p2.priceUsd).toBeLessThan(p1.priceUsd);
  });

  it("applies positive drift on each call", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000 }, driftPercent: 5 });
    const p1 = await feed.getPrice("ethereum");
    const p2 = await feed.getPrice("ethereum");
    expect(p2.priceUsd).toBeGreaterThan(p1.priceUsd);
  });

  it("setPrice overrides the current price", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000 } });
    feed.setPrice("ethereum", 1500);
    const point = await feed.getPrice("ethereum");
    expect(point.priceUsd).toBe(1500);
  });

  it("tracks call count per asset", async () => {
    const feed = new MockPriceFeed({ prices: { ethereum: 2000, bitcoin: 30000 } });
    await feed.getPrice("ethereum");
    await feed.getPrice("ethereum");
    await feed.getPrice("bitcoin");
    expect(feed.getCallCount("ethereum")).toBe(2);
    expect(feed.getCallCount("bitcoin")).toBe(1);
  });
});

describe("CoinGeckoPriceFeed", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns price from CoinGecko response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ethereum: { usd: 2345.67 } }),
    } as Response);

    const feed = new CoinGeckoPriceFeed();
    const point = await feed.getPrice("ethereum");

    expect(point.priceUsd).toBeCloseTo(2345.67);
    expect(point.asset).toBe("ethereum");
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);

    const feed = new CoinGeckoPriceFeed();
    await expect(feed.getPrice("ethereum")).rejects.toThrow("429");
  });

  it("throws when asset is absent in response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const feed = new CoinGeckoPriceFeed();
    await expect(feed.getPrice("ethereum")).rejects.toThrow('no USD price for asset "ethereum"');
  });

  it("includes Pro API key header when configured", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ethereum: { usd: 3000 } }),
    } as Response);

    const feed = new CoinGeckoPriceFeed({ apiKey: "test-key" });
    await feed.getPrice("ethereum");

    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ "x-cg-pro-api-key": "test-key" });
  });
});
