export interface InstrumentInfo {
  symbol: string;
  exchange: string;
  segment: string;
  instrumentToken: string;
  companyName?: string;
}

export interface LatestQuote {
  symbol: string;
  exchange: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  volume: number; // cumulative day volume (shares)
  averagePrice: number; // cumulative average trade price (VWAP approximation)
  bestBid: number;
  bestAsk: number;
  timestamp: number; // epoch ms — the instant this quote reflects
  receivedAt: number; // epoch ms — when the quote was received/produced
}

export type QuoteListener = (quote: LatestQuote) => void;

export interface MarketDataProvider {
  readonly supportsStreaming: boolean;
  readonly providerName: string;

  getInstruments(): Promise<InstrumentInfo[]>;

  subscribe(instruments: InstrumentInfo[]): Promise<void>;
  unsubscribe(instruments: InstrumentInfo[]): Promise<void>;

  // Return a point-in-time snapshot of the latest quote per symbol.
  getLatestSnapshots(): Promise<Map<string, LatestQuote>>;

  // Register a callback fired by the streaming feed whenever a quote updates.
  onQuote(listener: QuoteListener): () => void;

  healthCheck(): Promise<boolean>;
}
