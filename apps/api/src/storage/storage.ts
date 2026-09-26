import type { Readable } from "node:stream";

/**
 * Blob storage abstraction. Route handlers and services depend on this interface,
 * never on the AWS SDK, so MinIO/S3 can be swapped for local disk (or an in-memory fake in tests).
 */
export interface PutObjectInput {
  key: string;
  body: Readable | Buffer;
  contentType: string;
}

export interface StoredObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Cheap connectivity check used by /health. */
  ping(): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}
