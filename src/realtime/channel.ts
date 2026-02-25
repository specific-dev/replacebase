import type { WSContext } from "hono/ws";

// Phoenix protocol constants
export const PHX_JOIN = "phx_join";
export const PHX_LEAVE = "phx_leave";
export const PHX_REPLY = "phx_reply";
export const PHX_ERROR = "phx_error";
export const HEARTBEAT = "heartbeat";
export const PHOENIX_TOPIC = "phoenix";
export const BROADCAST = "broadcast";
export const PRESENCE = "presence";
export const PRESENCE_STATE = "presence_state";
export const PRESENCE_DIFF = "presence_diff";
export const ACCESS_TOKEN = "access_token";
export const SYSTEM = "system";

// Binary protocol constants
const KIND_USER_BROADCAST_PUSH = 3; // Client → server broadcast
const ENCODING_JSON = 1;

// Protocol types
export interface PhxMessage {
  topic: string;
  event: string;
  payload: any;
  ref: string | null;
  join_ref: string | null;
}

export interface JoinConfig {
  broadcast?: { self?: boolean; ack?: boolean };
  presence?: { key?: string; enabled?: boolean };
  postgres_changes?: Array<{
    event: string;
    schema: string;
    table?: string;
    filter?: string;
  }>;
  private?: boolean;
}

export interface JoinPayload {
  config: JoinConfig;
  access_token?: string;
}

export interface PresenceMeta {
  phx_ref: string;
  phx_ref_prev?: string;
  [key: string]: any;
}

export interface PresenceDiff {
  joins: Record<string, { metas: PresenceMeta[] }>;
  leaves: Record<string, { metas: PresenceMeta[] }>;
}

interface Subscriber {
  ws: WSContext;
  joinRef: string;
  config: JoinConfig;
  accessToken?: string;
  presenceKey: string;
  presenceRef: string | null;
}

/**
 * Decode a binary v2 broadcast message (kind 3 = userBroadcastPush).
 *
 * Wire format:
 *   byte 0: kind (3)
 *   byte 1: joinRef length
 *   byte 2: ref length
 *   byte 3: topic length
 *   byte 4: userEvent length
 *   byte 5: metadata length
 *   byte 6: encoding type (0 = binary, 1 = JSON)
 *   then: joinRef + ref + topic + userEvent + metadata + payload
 */
function decodeBinaryMessage(buffer: ArrayBuffer): PhxMessage | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 7) return null;

  const kind = view.getUint8(0);
  if (kind !== KIND_USER_BROADCAST_PUSH) return null;

  const joinRefLen = view.getUint8(1);
  const refLen = view.getUint8(2);
  const topicLen = view.getUint8(3);
  const eventLen = view.getUint8(4);
  const metadataLen = view.getUint8(5);
  const encodingType = view.getUint8(6);

  const decoder = new TextDecoder();
  let offset = 7;

  const joinRef = decoder.decode(buffer.slice(offset, offset + joinRefLen));
  offset += joinRefLen;

  const ref = decoder.decode(buffer.slice(offset, offset + refLen));
  offset += refLen;

  const topic = decoder.decode(buffer.slice(offset, offset + topicLen));
  offset += topicLen;

  const userEvent = decoder.decode(buffer.slice(offset, offset + eventLen));
  offset += eventLen;

  // Skip metadata (we don't use it)
  offset += metadataLen;

  const payloadBuf = buffer.slice(offset);
  const payload =
    encodingType === ENCODING_JSON
      ? JSON.parse(decoder.decode(payloadBuf))
      : payloadBuf;

  return {
    topic,
    event: BROADCAST,
    payload: { type: "broadcast", event: userEvent, payload },
    ref: ref || null,
    join_ref: joinRef || null,
  };
}

/**
 * Parse a Phoenix protocol message from string (v1 object or v2 array) or
 * binary (v2 broadcast push) format.
 */
export function parseMessage(data: string | ArrayBuffer): PhxMessage | null {
  if (data instanceof ArrayBuffer) {
    return decodeBinaryMessage(data);
  }

  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      // v2 format: [join_ref, ref, topic, event, payload]
      const [join_ref, ref, topic, event, payload] = parsed;
      return { join_ref, ref, topic, event, payload };
    }
    // v1 format: { topic, event, payload, ref, join_ref }
    return parsed as PhxMessage;
  } catch {
    return null;
  }
}

/**
 * Serialize a Phoenix message to the v2 JSON array format.
 */
export function serializeMessage(msg: PhxMessage): string {
  return JSON.stringify([
    msg.join_ref,
    msg.ref,
    msg.topic,
    msg.event,
    msg.payload,
  ]);
}

function sendToWs(ws: WSContext, msg: PhxMessage): void {
  try {
    if (ws.readyState === 1) {
      ws.send(serializeMessage(msg));
    }
  } catch {
    // Connection may be closed
  }
}

export class Channel {
  topic: string;
  private subscribers = new Map<WSContext, Subscriber>();
  private presenceState = new Map<string, PresenceMeta[]>();
  private refCounter = 0;

  constructor(topic: string) {
    this.topic = topic;
  }

  private nextRef(): string {
    return (++this.refCounter).toString();
  }

  get isEmpty(): boolean {
    return this.subscribers.size === 0;
  }

  hasSubscriber(ws: WSContext): boolean {
    return this.subscribers.has(ws);
  }

  join(
    ws: WSContext,
    config: JoinConfig,
    joinRef: string,
    accessToken?: string
  ): void {
    const presenceKey = config.presence?.key || crypto.randomUUID();
    this.subscribers.set(ws, {
      ws,
      joinRef,
      config,
      accessToken,
      presenceKey,
      presenceRef: null,
    });
  }

  leave(ws: WSContext): PresenceDiff | null {
    const sub = this.subscribers.get(ws);
    if (!sub) return null;

    let diff: PresenceDiff | null = null;
    if (sub.presenceRef) {
      diff = this.removePresence(ws);
    }
    this.subscribers.delete(ws);
    return diff;
  }

  broadcast(event: string, payload: any, sender: WSContext): void {
    const senderSub = this.subscribers.get(sender);

    for (const [ws, sub] of this.subscribers) {
      if (ws === sender && !senderSub?.config.broadcast?.self) {
        continue;
      }
      sendToWs(ws, {
        topic: this.topic,
        event: BROADCAST,
        payload: { type: "broadcast", event, payload },
        ref: null,
        join_ref: null,
      });
    }
  }

  trackPresence(
    ws: WSContext,
    payload: Record<string, any>
  ): PresenceDiff | null {
    const sub = this.subscribers.get(ws);
    if (!sub) return null;

    const key = sub.presenceKey;
    const newRef = this.nextRef();
    const oldRef = sub.presenceRef;
    const diff: PresenceDiff = { joins: {}, leaves: {} };

    // Remove old entry if re-tracking
    if (oldRef) {
      const entries = this.presenceState.get(key) || [];
      const oldEntry = entries.find((e) => e.phx_ref === oldRef);
      if (oldEntry) {
        diff.leaves[key] = { metas: [{ ...oldEntry }] };
        this.presenceState.set(
          key,
          entries.filter((e) => e.phx_ref !== oldRef)
        );
      }
    }

    // Add new entry
    const meta: PresenceMeta = {
      ...payload,
      phx_ref: newRef,
      ...(oldRef ? { phx_ref_prev: oldRef } : {}),
    };

    const entries = this.presenceState.get(key) || [];
    entries.push(meta);
    this.presenceState.set(key, entries);
    sub.presenceRef = newRef;

    diff.joins[key] = { metas: [meta] };
    return diff;
  }

  removePresence(ws: WSContext): PresenceDiff | null {
    const sub = this.subscribers.get(ws);
    if (!sub || !sub.presenceRef) return null;

    const key = sub.presenceKey;
    const entries = this.presenceState.get(key) || [];
    const entry = entries.find((e) => e.phx_ref === sub.presenceRef);
    if (!entry) return null;

    const diff: PresenceDiff = {
      joins: {},
      leaves: { [key]: { metas: [{ ...entry }] } },
    };

    const remaining = entries.filter((e) => e.phx_ref !== sub.presenceRef);
    if (remaining.length === 0) {
      this.presenceState.delete(key);
    } else {
      this.presenceState.set(key, remaining);
    }

    sub.presenceRef = null;
    return diff;
  }

  getPresenceState(): Record<string, { metas: PresenceMeta[] }> {
    const state: Record<string, { metas: PresenceMeta[] }> = {};
    for (const [key, metas] of this.presenceState) {
      state[key] = { metas: [...metas] };
    }
    return state;
  }

  broadcastPresenceDiff(diff: PresenceDiff): void {
    for (const [ws] of this.subscribers) {
      sendToWs(ws, {
        topic: this.topic,
        event: PRESENCE_DIFF,
        payload: diff,
        ref: null,
        join_ref: null,
      });
    }
  }

  sendPresenceState(ws: WSContext): void {
    const sub = this.subscribers.get(ws);
    if (!sub) return;

    sendToWs(ws, {
      topic: this.topic,
      event: PRESENCE_STATE,
      payload: this.getPresenceState(),
      ref: null,
      join_ref: sub.joinRef,
    });
  }

  updateAccessToken(ws: WSContext, token: string): void {
    const sub = this.subscribers.get(ws);
    if (sub) {
      sub.accessToken = token;
    }
  }
}

export class ChannelManager {
  private channels = new Map<string, Channel>();

  getOrCreate(topic: string): Channel {
    let channel = this.channels.get(topic);
    if (!channel) {
      channel = new Channel(topic);
      this.channels.set(topic, channel);
    }
    return channel;
  }

  get(topic: string): Channel | undefined {
    return this.channels.get(topic);
  }

  removeSubscriberFromAll(ws: WSContext): void {
    for (const [topic, channel] of this.channels) {
      const diff = channel.leave(ws);
      if (diff) {
        channel.broadcastPresenceDiff(diff);
      }
      if (channel.isEmpty) {
        this.channels.delete(topic);
      }
    }
  }
}
