import { WebSocket } from 'ws';
import type { LatestQuote } from '../providers/MarketDataProvider.js';
import type { MarketDataService } from '../services/MarketDataService.js';

export interface WsQuoteMessage {
  type: 'quote';
  symbol: string;
  ltp: number;
  dayChangePercent: number;
  dayChange: number;
  volume: number;
  averagePrice: number;
  bestBid: number;
  bestAsk: number;
  timestamp: number;
  receivedAt: number;
}

export interface WsSnapshotMessage {
  type: 'snapshot';
  quotes: WsQuoteMessage[];
}

export interface WsControlMessage {
  type: 'subscribe' | 'unsubscribe';
  symbols?: string[];
}

export interface WsInfoMessage {
  type: 'info';
  message: string;
}

export interface WsErrorMessage {
  type: 'error';
  message: string;
}

export interface WsSubscribedMessage {
  type: 'subscribed';
  symbols: string[];
}

export type WsServerMessage =
  | WsSnapshotMessage
  | WsQuoteMessage
  | WsInfoMessage
  | WsErrorMessage
  | WsSubscribedMessage;

const MAX_CLIENTS = 100;

export class QuoteBroadcaster {
  private clients = new Set<WebSocket>();
  private unsub: (() => void) | null = null;
  private readonly dataService: MarketDataService;

  constructor(dataService: MarketDataService) {
    this.dataService = dataService;
  }

  attach(): void {
    if (this.unsub) return;
    this.unsub = this.dataService.onQuote((q) => this.broadcast(q));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  addClient(ws: WebSocket): void {
    if (this.clients.size >= MAX_CLIENTS) {
      ws.close(1013, 'Too many clients');
      return;
    }
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    this.sendSnapshot(ws);
  }

  broadcast(q: LatestQuote): void {
    const msg: WsQuoteMessage = {
      type: 'quote',
      symbol: q.symbol,
      ltp: q.ltp,
      dayChangePercent: q.dayChangePercent,
      dayChange: q.dayChange,
      volume: q.volume,
      averagePrice: q.averagePrice,
      bestBid: q.bestBid,
      bestAsk: q.bestAsk,
      timestamp: q.timestamp,
      receivedAt: q.receivedAt,
    };
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) c.send(payload);
    }
  }

  private sendSnapshot(ws: WebSocket): void {
    const quotes: WsQuoteMessage[] = [...this.dataService.getAllQuotes().values()].map((q) => ({
      type: 'quote' as const,
      symbol: q.symbol,
      ltp: q.ltp,
      dayChangePercent: q.dayChangePercent,
      dayChange: q.dayChange,
      volume: q.volume,
      averagePrice: q.averagePrice,
      bestBid: q.bestBid,
      bestAsk: q.bestAsk,
      timestamp: q.timestamp,
      receivedAt: q.receivedAt,
    }));
    const msg: WsSnapshotMessage = { type: 'snapshot', quotes };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}

export function registerWsRoutes(app: any, dataService: MarketDataService): QuoteBroadcaster {
  const broadcaster = new QuoteBroadcaster(dataService);
  broadcaster.attach();

  // Raw upgrade handler: any path that upgrades to WS gets a quote stream.
  app.websocketServer.on('connection', (socket: WebSocket) => {
    broadcaster.addClient(socket);
    socket.send(
      JSON.stringify({
        type: 'info',
        message: 'Connected to TopFlow quote stream; send {type:"subscribe",symbols:[...]}',
      }),
    );
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsControlMessage;
        if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
          socket.send(JSON.stringify({ type: 'subscribed', symbols: msg.symbols }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
      }
    });
  });

  app.addHook('onClose', () => {
    broadcaster.detach();
  });

  return broadcaster;
}