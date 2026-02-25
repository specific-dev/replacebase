import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createStorageTestEnv } from "../helpers.js";

describe("Storage Buckets", () => {
  let env: Awaited<ReturnType<typeof createStorageTestEnv>>;

  beforeAll(async () => {
    env = await createStorageTestEnv();
  });

  afterAll(async () => env.cleanup());

  it("creates a bucket", async () => {
    const { data, error } = await env.serviceSupabase.storage.createBucket(
      "my-bucket",
      { public: false }
    );

    expect(error).toBeNull();
    expect(data!.name).toBe("my-bucket");
  });

  it("lists buckets", async () => {
    const { data, error } = await env.serviceSupabase.storage.listBuckets();

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    expect(data!.some((b: any) => b.name === "my-bucket")).toBe(true);
  });

  it("gets a bucket by id", async () => {
    const { data, error } =
      await env.serviceSupabase.storage.getBucket("my-bucket");

    expect(error).toBeNull();
    expect(data!.name).toBe("my-bucket");
    expect(data!.public).toBe(false);
  });

  it("updates a bucket", async () => {
    const { data, error } = await env.serviceSupabase.storage.updateBucket(
      "my-bucket",
      { public: true }
    );

    expect(error).toBeNull();

    // Verify the update
    const { data: bucket } =
      await env.serviceSupabase.storage.getBucket("my-bucket");
    expect(bucket!.public).toBe(true);
  });

  it("creates a bucket with constraints", async () => {
    const { data, error } = await env.serviceSupabase.storage.createBucket(
      "constrained-bucket",
      {
        public: false,
        fileSizeLimit: 1024, // 1KB
        allowedMimeTypes: ["image/png", "image/jpeg"],
      }
    );

    expect(error).toBeNull();

    const { data: bucket } = await env.serviceSupabase.storage.getBucket(
      "constrained-bucket"
    );
    expect(bucket!.file_size_limit).toBe(1024);
    expect(bucket!.allowed_mime_types).toEqual(["image/png", "image/jpeg"]);
  });

  it("fails to delete a non-empty bucket", async () => {
    // First create a bucket and upload an object
    await env.serviceSupabase.storage.createBucket("non-empty-bucket", {
      public: false,
    });
    await env.serviceSupabase.storage
      .from("non-empty-bucket")
      .upload("test.txt", "hello", { contentType: "text/plain" });

    const { error } =
      await env.serviceSupabase.storage.deleteBucket("non-empty-bucket");
    expect(error).not.toBeNull();
  });

  it("empties a bucket", async () => {
    const { error } =
      await env.serviceSupabase.storage.emptyBucket("non-empty-bucket");
    expect(error).toBeNull();
  });

  it("deletes an empty bucket", async () => {
    const { error } =
      await env.serviceSupabase.storage.deleteBucket("non-empty-bucket");
    expect(error).toBeNull();

    const { data: buckets } =
      await env.serviceSupabase.storage.listBuckets();
    expect(buckets!.some((b: any) => b.name === "non-empty-bucket")).toBe(
      false
    );
  });
});
