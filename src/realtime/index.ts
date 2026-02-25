import type { Context } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import { createMiddleware } from "hono/factory";
import type { JwtKeys } from "../keys";
import {
  ChannelManager,
  parseMessage,
  serializeMessage,
  PHX_JOIN,
  PHX_LEAVE,
  PHX_REPLY,
  HEARTBEAT,
  PHOENIX_TOPIC,
  BROADCAST,
  PRESENCE,
  ACCESS_TOKEN,
  type PhxMessage,
  type JoinPayload,
} from "./channel.js";

export function createRealtimeHandler(keys: JwtKeys) {
  const channelManager = new ChannelManager();

  function sendReply(
    ws: WSContext,
    msg: PhxMessage,
    status: string,
    response: any = {}
  ): void {
    try {
      if (ws.readyState === 1) {
        ws.send(
          serializeMessage({
            topic: msg.topic,
            event: PHX_REPLY,
            payload: { status, response },
            ref: msg.ref,
            join_ref: msg.join_ref,
          })
        );
      }
    } catch {
      // Connection may be closed
    }
  }

  function handleMessage(ws: WSContext, msg: PhxMessage): void {
    // Heartbeat on the special "phoenix" topic
    if (msg.topic === PHOENIX_TOPIC && msg.event === HEARTBEAT) {
      sendReply(ws, msg, "ok");
      return;
    }

    switch (msg.event) {
      case PHX_JOIN: {
        const payload = msg.payload as JoinPayload;
        const config = payload.config || {};
        const channel = channelManager.getOrCreate(msg.topic);
        const joinRef = msg.join_ref || msg.ref || "0";

        channel.join(ws, config, joinRef, payload.access_token);

        // Reply with ok, echoing postgres_changes with assigned IDs
        const pgChanges = (config.postgres_changes || []).map((pc, i) => ({
          ...pc,
          id: i + 1,
        }));
        sendReply(ws, msg, "ok", { postgres_changes: pgChanges });

        // Send current presence state if presence is enabled
        if (config.presence?.enabled) {
          channel.sendPresenceState(ws);
        }
        break;
      }

      case PHX_LEAVE: {
        const channel = channelManager.get(msg.topic);
        if (channel) {
          const diff = channel.leave(ws);
          if (diff) {
            channel.broadcastPresenceDiff(diff);
          }
        }
        sendReply(ws, msg, "ok");
        break;
      }

      case BROADCAST: {
        const channel = channelManager.get(msg.topic);
        if (channel && channel.hasSubscriber(ws)) {
          const { event, payload } = msg.payload || {};
          if (event) {
            channel.broadcast(event, payload, ws);
          }
        }
        sendReply(ws, msg, "ok");
        break;
      }

      case PRESENCE: {
        const channel = channelManager.get(msg.topic);
        if (channel && channel.hasSubscriber(ws)) {
          const { event: presenceEvent, payload: presencePayload } =
            msg.payload || {};

          if (presenceEvent === "track") {
            const diff = channel.trackPresence(ws, presencePayload || {});
            if (diff) {
              channel.broadcastPresenceDiff(diff);
            }
          } else if (presenceEvent === "untrack") {
            const diff = channel.removePresence(ws);
            if (diff) {
              channel.broadcastPresenceDiff(diff);
            }
          }
        }
        sendReply(ws, msg, "ok");
        break;
      }

      case ACCESS_TOKEN: {
        const token = msg.payload?.access_token;
        if (token) {
          const channel = channelManager.get(msg.topic);
          if (channel) {
            channel.updateAccessToken(ws, token);
          }
        }
        sendReply(ws, msg, "ok");
        break;
      }
    }
  }

  // Middleware to verify the apikey query parameter
  const apiKeyCheck = createMiddleware(async (c, next) => {
    const apikey = c.req.query("apikey");
    if (!apikey) {
      return c.text("Missing apikey", 401);
    }
    try {
      await keys.verify(apikey);
    } catch {
      return c.text("Invalid API key", 401);
    }
    await next();
  });

  return {
    apiKeyCheck,
    handleConnection(_c: Context): WSEvents {
      return {
        onMessage(event, ws) {
          const msg = parseMessage(event.data);
          if (msg) {
            handleMessage(ws, msg);
          }
        },
        onClose(_event, ws) {
          channelManager.removeSubscriberFromAll(ws);
        },
        onError(_event, ws) {
          channelManager.removeSubscriberFromAll(ws);
        },
      };
    },
  };
}
