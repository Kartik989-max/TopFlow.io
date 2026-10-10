import logger from '../utils/logger.js';
import type { SignalDoc } from '../models/Signal.js';

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<boolean>;
}

export interface NotificationPayload {
  title: string;
  message: string;
  level?: 'info' | 'warning' | 'error';
}

class ConsoleProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<boolean> {
    logger.info(
      { title: payload.title, message: payload.message },
      `[NOTIFICATION] ${payload.title}: ${payload.message}`,
    );
    return true;
  }
}

// Optional Telegram provider (MVP best-effort). Disabled by default; requires
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
class TelegramProvider implements NotificationProvider {
  constructor(
    private readonly token: string | undefined,
    private readonly chatId: string | undefined,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const text = `<b>${payload.title}</b>\n${payload.message}`;
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: this.chatId!, text }),
    });
    return res.ok;
  }
}

export class NotificationService {
  private readonly providers: NotificationProvider[] = [new ConsoleProvider()];
  private readonly telegram: TelegramProvider;

  constructor() {
    this.telegram = new TelegramProvider(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID,
    );
    if (this.telegram.isConfigured()) this.providers.push(this.telegram);
  }

  async notify(payload: NotificationPayload): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.send(payload);
      } catch (err) {
        logger.warn({ err, provider: p.constructor.name }, 'Notification provider failed');
      }
    }
  }

  notifySignal(signal: SignalDoc): void {
    const relVol = signal.relativeVolume ?? 0;
    const msg =
      `${signal.companyName ?? signal.symbol} (${signal.symbol}) entered Top-${process.env.TOP_N ?? 5}\n` +
      `Time: ${signal.timestamp.toISOString()}\n` +
      `Change: ${signal.dayChangePercent.toFixed(2)}%\n` +
      `Relative Volume: ${relVol.toFixed(2)}x\n` +
      `5m Momentum: ${signal.momentum5m?.toFixed(2) ?? 'n/a'}%\n` +
      `NOTE: This is an informational signal only. No orders are placed.`;
    void this.notify({
      title: 'NEW SIGNAL (informational)',
      message: msg,
      level: 'info',
    });
  }
}
