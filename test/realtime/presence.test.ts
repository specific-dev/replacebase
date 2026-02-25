import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  createClient,
  type SupabaseClient,
  type RealtimeChannel,
} from "@supabase/supabase-js";
import { createTestEnv } from "../helpers.js";

describe("Realtime Presence", () => {
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

  function subscribeAndWait(channel: RealtimeChannel): Promise<void> {
    return new Promise((resolve, reject) => {
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
  }

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    for (const client of clients) {
      await client.removeAllChannels();
    }
    clients = [];
  });

  afterAll(async () => {
    env.cleanup();
  });

  it("should track and sync presence state", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    let syncCount = 0;

    const channel1 = client1.channel("presence-sync");
    channel1.on("presence", { event: "sync" }, () => {
      syncCount++;
    });
    await subscribeAndWait(channel1);

    await channel1.track({ user: "alice", status: "online" });

    // Wait for sync to fire
    await vi.waitFor(() => {
      expect(syncCount).toBeGreaterThan(0);
    });

    // Second client joins and tracks
    const channel2 = client2.channel("presence-sync");
    let client2SyncCount = 0;
    channel2.on("presence", { event: "sync" }, () => {
      client2SyncCount++;
    });
    await subscribeAndWait(channel2);

    await channel2.track({ user: "bob", status: "online" });

    // Wait for client2 to receive sync with both users
    await vi.waitFor(() => {
      const state = channel2.presenceState();
      const allPresences = Object.values(state).flat();
      expect(allPresences.length).toBeGreaterThanOrEqual(2);
    });

    const state = channel2.presenceState();
    const allPresences = Object.values(state).flat();
    const users = allPresences.map((p: any) => p.user);
    expect(users).toContain("alice");
    expect(users).toContain("bob");
  });

  it("should fire join events when a user tracks", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const joins: any[] = [];

    const channel1 = client1.channel("presence-join");
    channel1.on("presence", { event: "join" }, ({ key, newPresences }) => {
      joins.push({ key, newPresences });
    });
    await subscribeAndWait(channel1);

    const channel2 = client2.channel("presence-join");
    await subscribeAndWait(channel2);

    await channel2.track({ user: "bob" });

    await vi.waitFor(() => {
      expect(joins).toHaveLength(1);
    });

    expect(joins[0].newPresences[0].user).toBe("bob");
  });

  it("should fire leave events when a user untracks", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const leaves: any[] = [];

    const channel1 = client1.channel("presence-leave");
    channel1.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      leaves.push({ key, leftPresences });
    });
    await subscribeAndWait(channel1);

    const channel2 = client2.channel("presence-leave");
    await subscribeAndWait(channel2);

    await channel2.track({ user: "bob" });

    // Wait for join to propagate
    await vi.waitFor(() => {
      const state = channel1.presenceState();
      expect(Object.values(state).flat().length).toBeGreaterThan(0);
    });

    await channel2.untrack();

    await vi.waitFor(() => {
      expect(leaves).toHaveLength(1);
    });

    expect(leaves[0].leftPresences[0].user).toBe("bob");
  });

  it("should fire leave events when a client disconnects", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const leaves: any[] = [];

    const channel1 = client1.channel("presence-disconnect");
    channel1.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      leaves.push({ key, leftPresences });
    });
    await subscribeAndWait(channel1);

    const channel2 = client2.channel("presence-disconnect");
    await subscribeAndWait(channel2);

    await channel2.track({ user: "charlie" });

    // Wait for join to propagate
    await vi.waitFor(() => {
      const state = channel1.presenceState();
      expect(Object.values(state).flat().length).toBeGreaterThan(0);
    });

    // Disconnect client2 by removing all channels
    await client2.removeAllChannels();

    await vi.waitFor(() => {
      expect(leaves).toHaveLength(1);
    });

    expect(leaves[0].leftPresences[0].user).toBe("charlie");
  });

  it("should update presence when tracking again", async () => {
    const client1 = makeClient();
    const client2 = makeClient();

    const joins: any[] = [];
    const leaves: any[] = [];

    const channel1 = client1.channel("presence-update");
    channel1.on("presence", { event: "join" }, ({ newPresences }) => {
      joins.push(newPresences);
    });
    channel1.on("presence", { event: "leave" }, ({ leftPresences }) => {
      leaves.push(leftPresences);
    });
    await subscribeAndWait(channel1);

    const channel2 = client2.channel("presence-update");
    await subscribeAndWait(channel2);

    // First track
    await channel2.track({ user: "dave", status: "online" });

    await vi.waitFor(() => {
      expect(joins).toHaveLength(1);
    });

    expect(joins[0][0].status).toBe("online");

    // Update presence by re-tracking
    await channel2.track({ user: "dave", status: "away" });

    await vi.waitFor(() => {
      // Re-tracking produces a leave (old) + join (new)
      expect(joins).toHaveLength(2);
      expect(leaves).toHaveLength(1);
    });

    expect(joins[1][0].status).toBe("away");
    expect(leaves[0][0].status).toBe("online");
  });

  it("should return presence state via presenceState()", async () => {
    const client1 = makeClient();

    const channel = client1.channel("presence-state", {
      config: { presence: { key: "my-key" } },
    });
    channel.on("presence", { event: "sync" }, () => {});
    await subscribeAndWait(channel);

    await channel.track({ role: "admin" });

    await vi.waitFor(() => {
      const state = channel.presenceState();
      expect(Object.keys(state).length).toBeGreaterThan(0);
    });

    const state = channel.presenceState();
    // The key should be "my-key" as specified in the channel config
    const entries = state["my-key"];
    expect(entries).toBeDefined();
    expect(entries[0].role).toBe("admin");
    expect(entries[0].presence_ref).toBeDefined();
  });
});
