import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * One hub for every desk. Sockets use the hibernation API, so an idle hub is evicted
 * from memory and costs no duration; a broadcast wakes it, sends, and it sleeps again.
 */
export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Send one already-serialised message to every socket. Returns how many got it. */
  broadcast(message: string): number {
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
        sent++;
      } catch {
        // socket already closing; the runtime drops it
      }
    }
    return sent;
  }

  /** Clients only listen. */
  override webSocketMessage(): void {}

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  override webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed
    }
  }
}

export const hub = (env: Env) => env.LIVE.get(env.LIVE.idFromName('global'));
