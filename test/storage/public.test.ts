import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createStorageTestEnv } from "../helpers";

describe("Storage Public Access", () => {
  let env: Awaited<ReturnType<typeof createStorageTestEnv>>;

  beforeAll(async () => {
    env = await createStorageTestEnv();
    // Create a public bucket
    await env.serviceSupabase.storage.createBucket("public-bucket", {
      public: true,
    });
    // Create a private bucket
    await env.serviceSupabase.storage.createBucket("private-bucket", {
      public: false,
    });
    // Upload a file to public bucket
    await env.serviceSupabase.storage
      .from("public-bucket")
      .upload("public-file.txt", "public content", {
        contentType: "text/plain",
      });
    // Upload a file to private bucket
    await env.serviceSupabase.storage
      .from("private-bucket")
      .upload("private-file.txt", "private content", {
        contentType: "text/plain",
      });
  });

  afterAll(async () => env.cleanup());

  it("gets public URL for a public bucket", () => {
    const { data } = env.serviceSupabase.storage
      .from("public-bucket")
      .getPublicUrl("public-file.txt");

    expect(data.publicUrl).toContain("public-bucket");
    expect(data.publicUrl).toContain("public-file.txt");
  });

  it("downloads from public bucket without auth", async () => {
    const { data } = env.serviceSupabase.storage
      .from("public-bucket")
      .getPublicUrl("public-file.txt");

    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(true);

    const text = await response.text();
    expect(text).toBe("public content");
  });

  it("rejects public download from private bucket", async () => {
    // Construct a public URL pointing to the private bucket
    const publicUrl = `http://localhost:${env.port}/storage/v1/object/public/private-bucket/private-file.txt`;

    const response = await fetch(publicUrl);
    expect(response.ok).toBe(false);
  });
});
