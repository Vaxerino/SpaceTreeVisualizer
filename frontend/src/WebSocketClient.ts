type MessageHandler = (msg: Record<string, unknown>) => void;

/**
 * WebSocket client. Connects to the backend, dispatches incoming messages
 * to type-specific handlers. Auto-reconnects on close.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private readonly url: string;
  private reconnectDelay = 2000;

  constructor(url = 'ws://localhost:7422') {
    this.url = url;
    this.connect();
  }

  on(type: string, handler: MessageHandler): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[ws] connected');
      this.reconnectDelay = 2000;
      this.send({ type: 'subscribe_live' });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const handlers = this.handlers.get(msg['type'] as string) ?? [];
        for (const h of handlers) h(msg);
      } catch (e) {
        console.warn('[ws] failed to parse message', e);
      }
    };

    this.ws.onclose = () => {
      console.log(`[ws] disconnected, reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
    };

    this.ws.onerror = () => {
      // errors are followed by close, reconnect handles it
    };
  }
}
