import { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { eq, and, sql, ilike, asc, desc } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { StorageConfig } from "../types";
import { apiKeyMiddleware } from "../middleware/api-key";
import { withRLS, type RLSContext } from "../rest/rls";
import {
  storageBuckets,
  storageObjects,
} from "../db/schema";
import { S3ObjectStorage, type ObjectStorage } from "./s3";

export function createStorageRouter(
  db: PgDatabase<any, any, any>,
  jwtSecret: string,
  storageConfig: StorageConfig
): Hono {
  const app = new Hono();
  const objectStorage: ObjectStorage = new S3ObjectStorage(storageConfig);
  const auth = apiKeyMiddleware(jwtSecret);

  // ── Bucket endpoints ───────────────────────────────────────────

  // List buckets
  app.get("/bucket", auth, async (c) => {
    const ctx = getRLSContext(c);
    try {
      const buckets = await withRLS(db, ctx, (tx) =>
        tx.select().from(storageBuckets)
      );
      return c.json(formatBuckets(buckets));
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Get bucket
  app.get("/bucket/:id", auth, async (c) => {
    const id = c.req.param("id");
    const ctx = getRLSContext(c);
    try {
      const [bucket] = await withRLS(db, ctx, (tx) =>
        tx.select().from(storageBuckets).where(eq(storageBuckets.id, id))
      );
      if (!bucket) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }
      return c.json(formatBucket(bucket));
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Create bucket
  app.post("/bucket", auth, async (c) => {
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const bucketId = body.id || body.name;

    try {
      await withRLS(db, ctx, (tx) =>
        tx.insert(storageBuckets).values({
          id: bucketId,
          name: body.name || bucketId,
          owner: ctx.userId || undefined,
          ownerId: ctx.userId || undefined,
          public: body.public ?? false,
          fileSizeLimit: body.file_size_limit ?? null,
          allowedMimeTypes: body.allowed_mime_types ?? null,
        })
      );
      return c.json({ name: body.name || bucketId });
    } catch (error: any) {
      if (error.message?.includes("duplicate") || error.message?.includes("unique")) {
        return c.json({ statusCode: "409", error: "Bucket already exists", message: "The resource already exists" }, 409);
      }
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Update bucket
  app.put("/bucket/:id", auth, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const ctx = getRLSContext(c);

    const updates: Record<string, any> = {};
    if (body.public !== undefined) updates.public = body.public;
    if (body.file_size_limit !== undefined) updates.fileSizeLimit = body.file_size_limit;
    if (body.allowed_mime_types !== undefined) updates.allowedMimeTypes = body.allowed_mime_types;

    try {
      const result = await withRLS(db, ctx, (tx) =>
        tx
          .update(storageBuckets)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(storageBuckets.id, id))
          .returning()
      );
      if (result.length === 0) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }
      return c.json({ message: "Successfully updated" });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Empty bucket
  app.post("/bucket/:id/empty", auth, async (c) => {
    const id = c.req.param("id");
    const ctx = getRLSContext(c);

    try {
      // Get all objects in bucket
      const objects = await withRLS(db, ctx, (tx) =>
        tx
          .select({ id: storageObjects.id, name: storageObjects.name })
          .from(storageObjects)
          .where(eq(storageObjects.bucketId, id))
      );

      if (objects.length > 0) {
        // Delete from S3
        const s3Keys = objects.map((o) => o.name!);
        await objectStorage.deleteObjects(s3Keys, id);

        // Delete from DB
        await withRLS(db, ctx, (tx) =>
          tx.delete(storageObjects).where(eq(storageObjects.bucketId, id))
        );
      }

      return c.json({ message: "Successfully emptied" });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Delete bucket
  app.delete("/bucket/:id", auth, async (c) => {
    const id = c.req.param("id");
    const ctx = getRLSContext(c);

    try {
      // Check if bucket has objects
      const objects = await withRLS(db, ctx, (tx) =>
        tx
          .select({ id: storageObjects.id })
          .from(storageObjects)
          .where(eq(storageObjects.bucketId, id))
          .limit(1)
      );

      if (objects.length > 0) {
        return c.json(
          { statusCode: "409", error: "Bucket not empty", message: "The bucket you tried to delete is not empty" },
          409
        );
      }

      const result = await withRLS(db, ctx, (tx) =>
        tx.delete(storageBuckets).where(eq(storageBuckets.id, id)).returning()
      );

      if (result.length === 0) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }

      return c.json({ message: "Successfully deleted" });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // ── Object endpoints ───────────────────────────────────────────

  // Move object
  app.post("/object/move", auth, async (c) => {
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const { bucketId, sourceKey, destinationKey } = body;

    try {
      // Verify source object exists
      const [sourceObj] = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(
            and(
              eq(storageObjects.bucketId, bucketId),
              eq(storageObjects.name, sourceKey)
            )
          )
      );

      if (!sourceObj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      // Copy in S3 then delete original
      await objectStorage.copyObject(sourceKey, destinationKey, bucketId);
      await objectStorage.deleteObject(sourceKey, bucketId);

      // Update DB record
      await withRLS(db, ctx, (tx) =>
        tx
          .update(storageObjects)
          .set({ name: destinationKey, updatedAt: new Date() })
          .where(eq(storageObjects.id, sourceObj.id))
      );

      return c.json({ message: "Successfully moved" });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Copy object
  app.post("/object/copy", auth, async (c) => {
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const { bucketId, sourceKey, destinationKey } = body;

    try {
      // Verify source object exists
      const [sourceObj] = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(
            and(
              eq(storageObjects.bucketId, bucketId),
              eq(storageObjects.name, sourceKey)
            )
          )
      );

      if (!sourceObj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      // Copy in S3
      await objectStorage.copyObject(sourceKey, destinationKey, bucketId);

      // Insert new DB record
      await withRLS(db, ctx, (tx) =>
        tx.insert(storageObjects).values({
          bucketId,
          name: destinationKey,
          owner: sourceObj.owner,
          ownerId: sourceObj.ownerId,
          metadata: sourceObj.metadata,
          userMetadata: sourceObj.userMetadata,
        })
      );

      return c.json({ key: `${bucketId}/${destinationKey}` });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // List objects
  app.post("/object/list/:bucketId", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const body = await c.req.json();
    const ctx = getRLSContext(c);

    const prefix = body.prefix || "";
    const limit = body.limit || 100;
    const offset = body.offset || 0;
    const search = body.search || "";
    const sortBy = body.sortBy || { column: "name", order: "asc" };

    try {
      const conditions = [eq(storageObjects.bucketId, bucketId)];

      if (prefix) {
        conditions.push(ilike(storageObjects.name, `${prefix}%`));
      }
      if (search) {
        conditions.push(ilike(storageObjects.name, `%${search}%`));
      }

      const sortColumn =
        sortBy.column === "created_at"
          ? storageObjects.createdAt
          : sortBy.column === "updated_at"
            ? storageObjects.updatedAt
            : storageObjects.name;
      const sortFn = sortBy.order === "desc" ? desc : asc;

      const objects = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(and(...conditions))
          .orderBy(sortFn(sortColumn))
          .limit(limit)
          .offset(offset)
      );

      return c.json(formatObjects(objects));
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Get object info (authenticated)
  app.get("/object/info/:bucketId/*", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/info/${bucketId}/`);
    const ctx = getRLSContext(c);

    try {
      const [obj] = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(
            and(
              eq(storageObjects.bucketId, bucketId),
              eq(storageObjects.name, objectPath)
            )
          )
      );

      if (!obj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      // Get S3 metadata
      const head = await objectStorage.headObject(objectPath, bucketId);

      return c.json({
        ...formatObject(obj),
        content_type: head.contentType,
        content_length: head.contentLength,
        etag: head.etag,
      });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // ── Signed URL endpoints ───────────────────────────────────────

  // Create signed upload URL
  app.post("/object/upload/sign/:bucketId/*", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/upload/sign/${bucketId}/`);
    const ctx = getRLSContext(c);

    try {
      // Verify bucket exists
      const [bucket] = await withRLS(db, ctx, (tx) =>
        tx.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId))
      );
      if (!bucket) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }

      const token = await createSignedToken(jwtSecret, {
        url: `${bucketId}/${objectPath}`,
        type: "upload",
        owner: ctx.userId,
      });

      return c.json({
        url: `/object/upload/sign/${bucketId}/${objectPath}?token=${token}`,
        token,
      });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Upload via signed URL (no auth)
  app.put("/object/upload/sign/:bucketId/*", async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/upload/sign/${bucketId}/`);
    const token = c.req.query("token");

    if (!token) {
      return c.json({ statusCode: "400", error: "Missing token", message: "Missing token" }, 400);
    }

    try {
      const payload = await verifySignedToken(jwtSecret, token);
      if (payload.url !== `${bucketId}/${objectPath}` || payload.type !== "upload") {
        return c.json({ statusCode: "403", error: "Invalid token", message: "Invalid token for this resource" }, 403);
      }

      // Get bucket
      const [bucket] = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId));
      if (!bucket) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }

      const contentType = c.req.header("Content-Type") || "application/octet-stream";
      const cacheControl = c.req.header("Cache-Control") || undefined;
      const bodyBuffer = Buffer.from(await c.req.arrayBuffer());

      // Validate bucket constraints
      const validationError = validateUpload(bucket, bodyBuffer.length, contentType);
      if (validationError) return validationError(c);

      // Upload to S3
      await objectStorage.putObject(objectPath, bodyBuffer, { contentType, cacheControl }, bucketId);

      // Upsert DB record
      const ownerId = payload.owner || null;
      await upsertObject(db, {
        bucketId,
        name: objectPath,
        owner: ownerId,
        ownerId,
        metadata: { mimetype: contentType, size: bodyBuffer.length, cacheControl: cacheControl || "" },
      });

      return c.json({
        Key: `${bucketId}/${objectPath}`,
      });
    } catch (error: any) {
      if (error.code === "ERR_JWT_EXPIRED") {
        return c.json({ statusCode: "403", error: "Token expired", message: "Signed URL has expired" }, 403);
      }
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Batch create signed download URLs (must be before wildcard route)
  app.post("/object/sign/:bucketId", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const expiresIn = body.expiresIn || 3600;
    const paths: string[] = body.paths || [];

    try {
      const results = await Promise.all(
        paths.map(async (objectPath: string) => {
          const [obj] = await withRLS(db, ctx, (tx) =>
            tx
              .select()
              .from(storageObjects)
              .where(
                and(
                  eq(storageObjects.bucketId, bucketId),
                  eq(storageObjects.name, objectPath)
                )
              )
          );

          if (!obj) {
            return { error: "Object not found", path: objectPath, signedURL: null };
          }

          const token = await createSignedToken(jwtSecret, {
            url: `${bucketId}/${objectPath}`,
            type: "download",
          }, expiresIn);

          return {
            error: null,
            path: objectPath,
            signedURL: `/object/sign/${bucketId}/${objectPath}?token=${token}`,
          };
        })
      );

      return c.json(results);
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Create signed download URL (single)
  app.post("/object/sign/:bucketId/*", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/sign/${bucketId}/`);
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const expiresIn = body.expiresIn || 3600;

    try {
      // Verify object exists and user has access
      const [obj] = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(
            and(
              eq(storageObjects.bucketId, bucketId),
              eq(storageObjects.name, objectPath)
            )
          )
      );

      if (!obj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      const token = await createSignedToken(jwtSecret, {
        url: `${bucketId}/${objectPath}`,
        type: "download",
      }, expiresIn);

      const signedURL = `/object/sign/${bucketId}/${objectPath}?token=${token}`;
      return c.json({ signedURL });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Access via signed URL (no auth)
  app.get("/object/sign/:bucketId/*", async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/sign/${bucketId}/`);
    const token = c.req.query("token");

    if (!token) {
      return c.json({ statusCode: "400", error: "Missing token", message: "Missing token" }, 400);
    }

    try {
      const payload = await verifySignedToken(jwtSecret, token);
      if (payload.url !== `${bucketId}/${objectPath}` || payload.type !== "download") {
        return c.json({ statusCode: "403", error: "Invalid token", message: "Invalid token for this resource" }, 403);
      }

      const result = await objectStorage.getObject(objectPath, bucketId);

      return new Response(result.body, {
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.contentLength),
          "ETag": result.etag,
          ...(result.cacheControl ? { "Cache-Control": result.cacheControl } : {}),
        },
      });
    } catch (error: any) {
      if (error.code === "ERR_JWT_EXPIRED") {
        return c.json({ statusCode: "403", error: "Token expired", message: "Signed URL has expired" }, 403);
      }
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // ── Public endpoints (no auth) ─────────────────────────────────

  // Public download
  app.get("/object/public/:bucketId/*", async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/public/${bucketId}/`);

    try {
      // Verify bucket is public
      const [bucket] = await db
        .select()
        .from(storageBuckets)
        .where(eq(storageBuckets.id, bucketId));

      if (!bucket) {
        return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
      }
      if (!bucket.public) {
        return c.json({ statusCode: "400", error: "Bucket is not public", message: "Bucket is not public" }, 400);
      }

      // Verify object exists in DB
      const [obj] = await db
        .select()
        .from(storageObjects)
        .where(
          and(
            eq(storageObjects.bucketId, bucketId),
            eq(storageObjects.name, objectPath)
          )
        );

      if (!obj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      // Stream from S3
      const result = await objectStorage.getObject(objectPath, bucketId);

      return new Response(result.body, {
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.contentLength),
          "ETag": result.etag,
          ...(result.cacheControl ? { "Cache-Control": result.cacheControl } : {}),
        },
      });
    } catch (error: any) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Public object info
  app.get("/object/info/public/:bucketId/*", async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/info/public/${bucketId}/`);

    try {
      const [bucket] = await db
        .select()
        .from(storageBuckets)
        .where(eq(storageBuckets.id, bucketId));

      if (!bucket || !bucket.public) {
        return c.json({ statusCode: "404", error: "Not found", message: "Not found" }, 404);
      }

      const [obj] = await db
        .select()
        .from(storageObjects)
        .where(
          and(
            eq(storageObjects.bucketId, bucketId),
            eq(storageObjects.name, objectPath)
          )
        );

      if (!obj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      const head = await objectStorage.headObject(objectPath, bucketId);

      return c.json({
        ...formatObject(obj),
        content_type: head.contentType,
        content_length: head.contentLength,
        etag: head.etag,
      });
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // ── Authenticated object operations ────────────────────────────

  // Upload object (POST)
  app.post("/object/:bucketId/*", auth, async (c) => {
    return handleUpload(c, db, objectStorage, false);
  });

  // Replace object (PUT)
  app.put("/object/:bucketId/*", auth, async (c) => {
    return handleUpload(c, db, objectStorage, true);
  });

  // Download object (authenticated)
  app.get("/object/:bucketId/*", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const objectPath = extractObjectPath(c.req.path, `/object/${bucketId}/`);
    const ctx = getRLSContext(c);

    try {
      // Verify access via RLS
      const [obj] = await withRLS(db, ctx, (tx) =>
        tx
          .select()
          .from(storageObjects)
          .where(
            and(
              eq(storageObjects.bucketId, bucketId),
              eq(storageObjects.name, objectPath)
            )
          )
      );

      if (!obj) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }

      // Stream from S3
      const result = await objectStorage.getObject(objectPath, bucketId);

      // Update last accessed
      await db
        .update(storageObjects)
        .set({ lastAccessedAt: new Date() })
        .where(eq(storageObjects.id, obj.id));

      return new Response(result.body, {
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.contentLength),
          "ETag": result.etag,
          ...(result.cacheControl ? { "Cache-Control": result.cacheControl } : {}),
        },
      });
    } catch (error: any) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return c.json({ statusCode: "404", error: "Object not found", message: "Object not found" }, 404);
      }
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  // Batch delete objects
  app.delete("/object/:bucketId", auth, async (c) => {
    const bucketId = c.req.param("bucketId");
    const body = await c.req.json();
    const ctx = getRLSContext(c);
    const prefixes: string[] = body.prefixes || [];

    try {
      const deleted: Array<{ name: string }> = [];

      for (const prefix of prefixes) {
        const [obj] = await withRLS(db, ctx, (tx) =>
          tx
            .select()
            .from(storageObjects)
            .where(
              and(
                eq(storageObjects.bucketId, bucketId),
                eq(storageObjects.name, prefix)
              )
            )
        );

        if (obj) {
          await objectStorage.deleteObject(prefix, bucketId);
          await withRLS(db, ctx, (tx) =>
            tx.delete(storageObjects).where(eq(storageObjects.id, obj.id))
          );
          deleted.push({ name: prefix });
        }
      }

      return c.json(deleted);
    } catch (error: any) {
      return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
    }
  });

  return app;
}

// ── Helpers ────────────────────────────────────────────────────────

function getRLSContext(c: any): RLSContext {
  return {
    role: c.get?.("role") || "anon",
    claims: c.get?.("claims") || null,
    userId: c.get?.("userId") || null,
  };
}

function extractObjectPath(fullPath: string, prefix: string): string {
  // Find the prefix in the path and extract everything after it
  const idx = fullPath.indexOf(prefix);
  if (idx === -1) return "";
  return decodeURIComponent(fullPath.slice(idx + prefix.length));
}

async function handleUpload(
  c: any,
  db: PgDatabase<any, any, any>,
  objectStorage: ObjectStorage,
  isUpsert: boolean
) {
  const bucketId = c.req.param("bucketId");
  const objectPath = extractObjectPath(c.req.path, `/object/${bucketId}/`);
  const ctx = getRLSContext(c);
  const upsertHeader = c.req.header("x-upsert") === "true";
  const shouldUpsert = isUpsert || upsertHeader;

  try {
    // Get bucket
    const [bucket] = await withRLS(db, ctx, (tx) =>
      tx.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId))
    );

    if (!bucket) {
      return c.json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404);
    }

    // Parse body - handle both FormData and raw body
    let bodyBuffer: Buffer;
    let contentType: string;
    let cacheControl: string | undefined = c.req.header("Cache-Control") || undefined;

    const reqContentType = c.req.header("Content-Type") || "";
    if (reqContentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("") || formData.get("file");
      if (!file || !(file instanceof File)) {
        return c.json({ statusCode: "400", error: "No file provided", message: "No file provided in form data" }, 400);
      }
      bodyBuffer = Buffer.from(await file.arrayBuffer());
      contentType = file.type || "application/octet-stream";
      // FormData may include cacheControl field
      const ccField = formData.get("cacheControl");
      if (ccField && typeof ccField === "string") {
        cacheControl = ccField;
      }
    } else {
      bodyBuffer = Buffer.from(await c.req.arrayBuffer());
      contentType = reqContentType || "application/octet-stream";
    }

    // Validate bucket constraints
    const validationError = validateUpload(bucket, bodyBuffer.length, contentType);
    if (validationError) return validationError(c);

    // Parse user metadata from header
    let userMetadata: Record<string, string> | undefined;
    const metadataHeader = c.req.header("x-metadata");
    if (metadataHeader) {
      try {
        userMetadata = JSON.parse(metadataHeader);
      } catch {
        // ignore invalid metadata
      }
    }

    // Check if object already exists
    const [existing] = await withRLS(db, ctx, (tx) =>
      tx
        .select()
        .from(storageObjects)
        .where(
          and(
            eq(storageObjects.bucketId, bucketId),
            eq(storageObjects.name, objectPath)
          )
        )
    );

    if (existing && !shouldUpsert) {
      return c.json(
        { statusCode: "409", error: "Duplicate", message: "The resource already exists" },
        409
      );
    }

    // Upload to S3
    await objectStorage.putObject(objectPath, bodyBuffer, {
      contentType,
      cacheControl,
    }, bucketId);

    // Insert or update DB record
    const metadata = {
      mimetype: contentType,
      size: bodyBuffer.length,
      cacheControl: cacheControl || "",
    };

    let objectId: string;
    if (existing) {
      await withRLS(db, ctx, (tx) =>
        tx
          .update(storageObjects)
          .set({
            metadata,
            userMetadata: userMetadata || existing.userMetadata,
            updatedAt: new Date(),
          })
          .where(eq(storageObjects.id, existing.id))
      );
      objectId = existing.id;
    } else {
      const [inserted] = await withRLS(db, ctx, (tx) =>
        tx
          .insert(storageObjects)
          .values({
            bucketId,
            name: objectPath,
            owner: ctx.userId || undefined,
            ownerId: ctx.userId || undefined,
            metadata,
            userMetadata: userMetadata || undefined,
          })
          .returning({ id: storageObjects.id })
      );
      objectId = inserted.id;
    }

    return c.json({
      Id: objectId,
      Key: `${bucketId}/${objectPath}`,
    });
  } catch (error: any) {
    return c.json({ statusCode: "500", error: error.message, message: error.message }, 500);
  }
}

function validateUpload(
  bucket: any,
  size: number,
  contentType: string
): ((c: any) => Response) | null {
  if (bucket.fileSizeLimit && size > bucket.fileSizeLimit) {
    return (c: any) =>
      c.json(
        {
          statusCode: "413",
          error: "Payload too large",
          message: `The object exceeded the maximum allowed size of ${bucket.fileSizeLimit} bytes`,
        },
        413
      );
  }

  if (bucket.allowedMimeTypes && bucket.allowedMimeTypes.length > 0) {
    const allowed = bucket.allowedMimeTypes as string[];
    const matches = allowed.some((pattern: string) => {
      if (pattern === contentType) return true;
      // Support wildcard like "image/*"
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1);
        return contentType.startsWith(prefix);
      }
      return false;
    });
    if (!matches) {
      return (c: any) =>
        c.json(
          {
            statusCode: "415",
            error: "Unsupported media type",
            message: `Content type ${contentType} is not allowed. Allowed types: ${allowed.join(", ")}`,
          },
          415
        );
    }
  }

  return null;
}

async function upsertObject(
  db: PgDatabase<any, any, any>,
  values: {
    bucketId: string;
    name: string;
    owner: string | null;
    ownerId: string | null;
    metadata: Record<string, unknown>;
  }
) {
  const [existing] = await db
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.bucketId, values.bucketId),
        eq(storageObjects.name, values.name)
      )
    );

  if (existing) {
    await db
      .update(storageObjects)
      .set({
        metadata: values.metadata,
        updatedAt: new Date(),
      })
      .where(eq(storageObjects.id, existing.id));
    return existing.id;
  } else {
    const [inserted] = await db
      .insert(storageObjects)
      .values({
        bucketId: values.bucketId,
        name: values.name,
        owner: values.owner || undefined,
        ownerId: values.ownerId || undefined,
        metadata: values.metadata,
      })
      .returning({ id: storageObjects.id });
    return inserted.id;
  }
}

async function createSignedToken(
  jwtSecret: string,
  payload: { url: string; type: string; owner?: string | null },
  expiresInSeconds: number = 3600
): Promise<string> {
  const secret = new TextEncoder().encode(jwtSecret);
  return await new SignJWT({
    url: payload.url,
    type: payload.type,
    ...(payload.owner ? { owner: payload.owner } : {}),
    iss: "replacebase/storage",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secret);
}

async function verifySignedToken(
  jwtSecret: string,
  token: string
): Promise<{ url: string; type: string; owner?: string }> {
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as { url: string; type: string; owner?: string };
}

function formatBucket(b: any) {
  return {
    id: b.id,
    name: b.name,
    owner: b.owner || "",
    public: b.public ?? false,
    file_size_limit: b.fileSizeLimit ?? null,
    allowed_mime_types: b.allowedMimeTypes ?? null,
    created_at: b.createdAt?.toISOString() ?? null,
    updated_at: b.updatedAt?.toISOString() ?? null,
  };
}

function formatBuckets(buckets: any[]) {
  return buckets.map(formatBucket);
}

function formatObject(o: any) {
  return {
    id: o.id,
    name: o.name,
    bucket_id: o.bucketId,
    owner: o.owner || "",
    metadata: o.metadata ?? null,
    user_metadata: o.userMetadata ?? null,
    created_at: o.createdAt?.toISOString() ?? null,
    updated_at: o.updatedAt?.toISOString() ?? null,
    last_accessed_at: o.lastAccessedAt?.toISOString() ?? null,
  };
}

function formatObjects(objects: any[]) {
  return objects.map(formatObject);
}
