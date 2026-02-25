import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createStorageTestEnv } from "../helpers";

describe("Storage Objects", () => {
  let env: Awaited<ReturnType<typeof createStorageTestEnv>>;

  beforeAll(async () => {
    env = await createStorageTestEnv();
    // Create test bucket
    await env.serviceSupabase.storage.createBucket("files", { public: false });
  });

  afterAll(async () => env.cleanup());

  it("uploads a file", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .upload("hello.txt", "Hello, World!", {
        contentType: "text/plain",
      });

    expect(error).toBeNull();
    expect(data!.path).toBe("hello.txt");
  });

  it("downloads a file", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .download("hello.txt");

    expect(error).toBeNull();
    const text = await data!.text();
    expect(text).toBe("Hello, World!");
  });

  it("uploads binary data", async () => {
    const buffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .upload("binary.bin", buffer, {
        contentType: "application/octet-stream",
      });

    expect(error).toBeNull();
    expect(data!.path).toBe("binary.bin");

    // Download and verify
    const { data: downloaded } = await env.serviceSupabase.storage
      .from("files")
      .download("binary.bin");
    const downloadedBuffer = new Uint8Array(await downloaded!.arrayBuffer());
    expect(downloadedBuffer).toEqual(buffer);
  });

  it("uploads to a nested path", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .upload("folder/subfolder/deep.txt", "deep content", {
        contentType: "text/plain",
      });

    expect(error).toBeNull();
    expect(data!.path).toBe("folder/subfolder/deep.txt");
  });

  it("fails to upload duplicate without upsert", async () => {
    const { error } = await env.serviceSupabase.storage
      .from("files")
      .upload("hello.txt", "duplicate", {
        contentType: "text/plain",
      });

    expect(error).not.toBeNull();
  });

  it("upserts an existing file", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .upload("hello.txt", "Updated content", {
        contentType: "text/plain",
        upsert: true,
      });

    expect(error).toBeNull();

    // Verify content was updated
    const { data: downloaded } = await env.serviceSupabase.storage
      .from("files")
      .download("hello.txt");
    const text = await downloaded!.text();
    expect(text).toBe("Updated content");
  });

  it("replaces a file with update (PUT)", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .update("hello.txt", "Replaced content", {
        contentType: "text/plain",
      });

    expect(error).toBeNull();

    const { data: downloaded } = await env.serviceSupabase.storage
      .from("files")
      .download("hello.txt");
    const text = await downloaded!.text();
    expect(text).toBe("Replaced content");
  });

  it("lists objects in a bucket", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .list();

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("lists objects with prefix", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .list("folder");

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("moves an object", async () => {
    // Upload a file to move
    await env.serviceSupabase.storage
      .from("files")
      .upload("to-move.txt", "moveable", { contentType: "text/plain" });

    const { error } = await env.serviceSupabase.storage
      .from("files")
      .move("to-move.txt", "moved.txt");

    expect(error).toBeNull();

    // Verify original is gone
    const { error: downloadError } = await env.serviceSupabase.storage
      .from("files")
      .download("to-move.txt");
    expect(downloadError).not.toBeNull();

    // Verify new location works
    const { data: downloaded } = await env.serviceSupabase.storage
      .from("files")
      .download("moved.txt");
    const text = await downloaded!.text();
    expect(text).toBe("moveable");
  });

  it("copies an object", async () => {
    // Upload a file to copy
    await env.serviceSupabase.storage
      .from("files")
      .upload("original.txt", "copy me", { contentType: "text/plain" });

    const { error } = await env.serviceSupabase.storage
      .from("files")
      .copy("original.txt", "copied.txt");

    expect(error).toBeNull();

    // Verify both exist
    const { data: orig } = await env.serviceSupabase.storage
      .from("files")
      .download("original.txt");
    expect(await orig!.text()).toBe("copy me");

    const { data: copy } = await env.serviceSupabase.storage
      .from("files")
      .download("copied.txt");
    expect(await copy!.text()).toBe("copy me");
  });

  it("deletes objects", async () => {
    await env.serviceSupabase.storage
      .from("files")
      .upload("delete-me.txt", "bye", { contentType: "text/plain" });

    const { data, error } = await env.serviceSupabase.storage
      .from("files")
      .remove(["delete-me.txt"]);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);

    // Verify deleted
    const { error: downloadError } = await env.serviceSupabase.storage
      .from("files")
      .download("delete-me.txt");
    expect(downloadError).not.toBeNull();
  });
});
