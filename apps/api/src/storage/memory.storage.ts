import { Readable } from "node:stream";
import { ObjectNotFoundError, type ObjectStorage, type PutObjectInput, type StoredObject } from "./storage.js";

/** In-memory implementation, for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async put({ key, body, contentType }: PutObjectInput): Promise<void> {
    const data = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    this.objects.set(key, { data, contentType });
  }

  async get(key: string): Promise<StoredObject> {
    const obj = this.objects.get(key);
    if (!obj) throw new ObjectNotFoundError(key);
    return { body: Readable.from(obj.data), contentType: obj.contentType, contentLength: obj.data.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async ping(): Promise<void> {}
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
