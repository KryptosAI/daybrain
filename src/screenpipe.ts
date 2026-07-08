import { getConfig } from './config';

export interface ScreenpipeSearchResult {
  type: string;
  content: {
    text?: string;
    app_name?: string;
    window_name?: string;
    browser_url?: string;
    transcription?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

export class ScreenpipeClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getConfig().screenpipe.baseUrl;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async search(query: string, limit = 50): Promise<ScreenpipeSearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
      const json = await res.json() as { data?: ScreenpipeSearchResult[] };
      return json.data || [];
    } catch (err) {
      throw new Error(`Screenpipe search failed: ${err}`);
    }
  }

  async getRecentOCR(limit = 20): Promise<ScreenpipeSearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/search?content_type=ocr&limit=${limit}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`OCR fetch failed: HTTP ${res.status}`);
      const json = await res.json() as { data?: ScreenpipeSearchResult[] };
      return json.data || [];
    } catch (err) {
      console.error('[daybrain] Screenpipe OCR fetch failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async getRecentAudio(limit = 20): Promise<ScreenpipeSearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/search?content_type=audio&limit=${limit}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Audio fetch failed: HTTP ${res.status}`);
      const json = await res.json() as { data?: ScreenpipeSearchResult[] };
      return json.data || [];
    } catch (err) {
      console.error('[daybrain] Screenpipe audio fetch failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }
}

export function createScreenpipeClient(baseUrl?: string): ScreenpipeClient {
  return new ScreenpipeClient(baseUrl);
}
