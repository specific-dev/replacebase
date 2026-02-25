import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createStorageTestEnv } from "../helpers";

describe("Storage Signed URLs", () => {
  let env: Awaited<ReturnType<typeof createStorageTestEnv>>;

  beforeAll(async () => {
    env = await createStorageTestEnv();
    // Create bucket and upload a test file
    await env.serviceSupabase.storage.createBucket("signed-test", {
      public: false,
    });
    await env.serviceSupabase.storage
      .from("signed-test")
      .upload("secret.txt", "secret content", { contentType: "text/plain" });
  });

  afterAll(async () => env.cleanup());

  it("creates a signed download URL", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("signed-test")
      .createSignedUrl("secret.txt", 3600);

    expect(error).toBeNull();
    expect(data!.signedUrl).toContain("token=");
  });

  it("downloads via signed URL", async () => {
    const { data: signedData } = await env.serviceSupabase.storage
      .from("signed-test")
      .createSignedUrl("secret.txt", 3600);

    // Fetch the signed URL directly
    const response = await fetch(signedData!.signedUrl);
    expect(response.ok).toBe(true);

    const text = await response.text();
    expect(text).toBe("secret content");
  });

  it("creates batch signed URLs", async () => {
    // Upload another file
    await env.serviceSupabase.storage
      .from("signed-test")
      .upload("file2.txt", "file 2 content", { contentType: "text/plain" });

    const { data, error } = await env.serviceSupabase.storage
      .from("signed-test")
      .createSignedUrls(["secret.txt", "file2.txt"], 3600);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0].signedUrl).toContain("token=");
    expect(data![1].signedUrl).toContain("token=");
  });

  it("creates a signed upload URL", async () => {
    const { data, error } = await env.serviceSupabase.storage
      .from("signed-test")
      .createSignedUploadUrl("upload-via-signed.txt");

    expect(error).toBeNull();
    expect(data!.token).toBeTruthy();
    expect(data!.path).toBe("upload-via-signed.txt");
  });

  it("uploads via signed URL", async () => {
    const { data: signedData } = await env.serviceSupabase.storage
      .from("signed-test")
      .createSignedUploadUrl("signed-upload.txt");

    const { data, error } = await env.serviceSupabase.storage
      .from("signed-test")
      .uploadToSignedUrl("signed-upload.txt", signedData!.token, "signed upload content", {
        contentType: "text/plain",
      });

    expect(error).toBeNull();

    // Download and verify
    const { data: downloaded } = await env.serviceSupabase.storage
      .from("signed-test")
      .download("signed-upload.txt");
    const text = await downloaded!.text();
    expect(text).toBe("signed upload content");
  });
});
