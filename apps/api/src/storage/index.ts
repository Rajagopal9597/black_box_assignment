import type { Config } from "../config/env.js";
import { S3Storage } from "./s3.storage.js";
import type { ObjectStorage } from "./storage.js";

export * from "./storage.js";

export function createStorage(config: Config): ObjectStorage {
  return new S3Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}
