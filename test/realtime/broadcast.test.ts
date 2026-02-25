import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestEnv } from "../helpers.js";

describe("Realtime Broadcast", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let clients: SupabaseClient[] = [];

  function makeClient() {
    const client = createClient(
      `http://localhost:${env.port}`,
      env.anonKey
    );
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    for (const client of clients) {
      await client.removeAllChannels();
    }
    clients = [];
    await env.supabase.removeAllChannels();
  });

  afterAll(async () => {
    env.cleanup();
  });

  it("should deliver broadcast messages between clients", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const received: any[] = [];

    const channel1 = client1.channel("broadcast-test");
    channel1.on("broadcast", { event: "message" }, (payload) => {
      received.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel1.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const channel2 = client2.channel("broadcast-test");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel2.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel2.send({
      type: "broadcast",
      event: "message",
      payload: { text: "Hello from client 2!" },
    });

    // Wait for message delivery
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    expect(received[0].event).toBe("message");
    expect(received[0].payload).toEqual({ text: "Hello from client 2!" });
  });

  it("should not deliver broadcast to sender by default (self: false)", async () => {
    const client1 = makeClient();

    const received: any[] = [];

    const channel = client1.channel("self-test");
    channel.on("broadcast", { event: "ping" }, (payload) => {
      received.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel.send({
      type: "broadcast",
      event: "ping",
      payload: { data: "test" },
    });

    // Wait a bit to verify no message arrives
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(0);
  });

  it("should deliver broadcast to sender when self: true", async () => {
    const client1 = makeClient();

    const received: any[] = [];

    const channel = client1.channel("self-true-test", {
      config: { broadcast: { self: true } },
    });
    channel.on("broadcast", { event: "echo" }, (payload) => {
      received.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel.send({
      type: "broadcast",
      event: "echo",
      payload: { data: "self-test" },
    });

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    expect(received[0].payload).toEqual({ data: "self-test" });
  });

  it("should filter broadcast by event name", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const fooMessages: any[] = [];
    const barMessages: any[] = [];

    const channel1 = client1.channel("filter-test");
    channel1.on("broadcast", { event: "foo" }, (payload) => {
      fooMessages.push(payload);
    });
    channel1.on("broadcast", { event: "bar" }, (payload) => {
      barMessages.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel1.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const channel2 = client2.channel("filter-test");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel2.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel2.send({
      type: "broadcast",
      event: "foo",
      payload: { id: 1 },
    });
    await channel2.send({
      type: "broadcast",
      event: "bar",
      payload: { id: 2 },
    });

    await vi.waitFor(() => {
      expect(fooMessages).toHaveLength(1);
      expect(barMessages).toHaveLength(1);
    });

    expect(fooMessages[0].payload).toEqual({ id: 1 });
    expect(barMessages[0].payload).toEqual({ id: 2 });
  });

  it("should not deliver to clients on different channels", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const received: any[] = [];

    const channel1 = client1.channel("room-a");
    channel1.on("broadcast", { event: "msg" }, (payload) => {
      received.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel1.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const channel2 = client2.channel("room-b");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel2.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel2.send({
      type: "broadcast",
      event: "msg",
      payload: { text: "wrong room" },
    });

    // Wait to verify no message arrives
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(0);
  });

  it("should stop receiving after unsubscribing", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const received: any[] = [];

    const channel1 = client1.channel("unsub-test");
    channel1.on("broadcast", { event: "msg" }, (payload) => {
      received.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel1.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const channel2 = client2.channel("unsub-test");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel2.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Send first message - should be received
    await channel2.send({
      type: "broadcast",
      event: "msg",
      payload: { n: 1 },
    });

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    // Unsubscribe client1
    await client1.removeChannel(channel1);

    // Send second message - should NOT be received
    await channel2.send({
      type: "broadcast",
      event: "msg",
      payload: { n: 2 },
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(1);
  });

  it("should acknowledge broadcast when ack: true", async () => {
    const client1 = makeClient();

    const channel = client1.channel("ack-test", {
      config: { broadcast: { ack: true } },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Subscribe timeout")),
        5000
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const result = await channel.send({
      type: "broadcast",
      event: "ack-event",
      payload: { data: "test" },
    });

    expect(result).toBe("ok");
  });
});
