import multer from "multer";

/**
 * Multipart upload middleware (single file, field name "file").
 *
 * Memory storage: the file is buffered in RAM (bounded by MAX_UPLOAD_BYTES, default 25 MB) and then
 * handed to ObjectStorage.put(). Simple and fine at this size limit. For large files you'd stream
 * straight to object storage instead (see docs/DECISIONS.md).
 */
export function createUpload(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5 },
    defParamCharset: "utf8", // browsers send UTF-8 filenames; multer's default (latin1) garbles them
  }).single("file");
}
