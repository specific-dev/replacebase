import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "../types";

export interface ObjectStorageGetResult {
  body: ReadableStream;
  contentType: string;
  contentLength: number;
  etag: string;
  lastModified: Date;
  cacheControl?: string;
}

export interface ObjectStorageHeadResult {
  contentType: string;
  contentLength: number;
  etag: string;
  lastModified: Date;
}

export interface ObjectStoragePutOptions {
  contentType?: string;
  cacheControl?: string;
  contentLength?: number;
}

export interface ObjectStorage {
  putObject(
    key: string,
    body: Buffer | ReadableStream,
    options?: ObjectStoragePutOptions,
    bucket?: string
  ): Promise<void>;
  getObject(key: string, bucket?: string): Promise<ObjectStorageGetResult>;
  deleteObject(key: string, bucket?: string): Promise<void>;
  deleteObjects(keys: string[], bucket?: string): Promise<void>;
  copyObject(sourceKey: string, destKey: string, bucket?: string): Promise<void>;
  headObject(key: string, bucket?: string): Promise<ObjectStorageHeadResult>;
}

export class S3ObjectStorage implements ObjectStorage {
  private client: S3Client;
  private bucket: string;
  private keyPrefix: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: config.s3.forcePathStyle ?? true,
    });
    this.bucket = config.s3.bucket;
    this.keyPrefix = config.keyPrefix || "";
  }

  private fullKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}/${key}` : key;
  }

  private resolveBucket(bucket?: string): string {
    return bucket || this.bucket;
  }

  async putObject(
    key: string,
    body: Buffer | ReadableStream,
    options?: ObjectStoragePutOptions,
    bucket?: string
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: this.fullKey(key),
        Body: Buffer.isBuffer(body) ? body : await streamToBuffer(body as ReadableStream),
        ContentType: options?.contentType,
        CacheControl: options?.cacheControl,
        ContentLength: options?.contentLength,
      })
    );
  }

  async getObject(key: string, bucket?: string): Promise<ObjectStorageGetResult> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: this.fullKey(key),
      })
    );

    return {
      body: result.Body!.transformToWebStream(),
      contentType: result.ContentType || "application/octet-stream",
      contentLength: result.ContentLength || 0,
      etag: result.ETag || "",
      lastModified: result.LastModified || new Date(),
      cacheControl: result.CacheControl || undefined,
    };
  }

  async deleteObject(key: string, bucket?: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: this.fullKey(key),
      })
    );
  }

  async deleteObjects(keys: string[], bucket?: string): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.resolveBucket(bucket),
        Delete: {
          Objects: keys.map((k) => ({ Key: this.fullKey(k) })),
        },
      })
    );
  }

  async copyObject(sourceKey: string, destKey: string, bucket?: string): Promise<void> {
    const resolvedBucket = this.resolveBucket(bucket);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: resolvedBucket,
        CopySource: `${resolvedBucket}/${this.fullKey(sourceKey)}`,
        Key: this.fullKey(destKey),
      })
    );
  }

  async headObject(key: string, bucket?: string): Promise<ObjectStorageHeadResult> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.resolveBucket(bucket),
        Key: this.fullKey(key),
      })
    );

    return {
      contentType: result.ContentType || "application/octet-stream",
      contentLength: result.ContentLength || 0,
      etag: result.ETag || "",
      lastModified: result.LastModified || new Date(),
    };
  }
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
