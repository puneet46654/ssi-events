import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpError } from '../http.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Lambda caps request bodies at 6 MB including encoding
const BUCKET = process.env.IMAGE_BUCKET || 'ssi-studio-events';
const TYPES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
type Format = keyof typeof TYPES;

const s3 = new S3Client({});

function sniff(bytes: Buffer): Format | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Accepts only genuine still JPG/PNG/WebP up to 4 MB and 25 megapixels. The image is fully decoded
 * and re-encoded, which drops metadata (GPS, camera) and anything smuggled inside the file.
 */
export async function sanitizeImage(file: File): Promise<{ body: Buffer; contentType: string; extension: string }> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new HttpError(400, 'Choose an image no larger than 4 MB.');
  const input = Buffer.from(await file.arrayBuffer());
  const format = sniff(input);
  if (!format || (file.type && file.type !== TYPES[format])) {
    throw new HttpError(400, 'Choose a genuine JPG, PNG or WebP image with a matching file type.');
  }
  const { default: sharp } = await import('sharp'); // native module: loaded only when an image arrives
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: 25_000_000 });
    const meta = await image.metadata();
    if (meta.format !== format || (meta.pages || 1) > 1) throw new Error('unsupported');
    const body = await image.rotate().toFormat(format).toBuffer();
    if (body.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'Choose an image no larger than 4 MB.');
    return { body, contentType: TYPES[format], extension: format === 'jpeg' ? 'jpg' : format };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'The image is damaged, animated, or exceeds 25 megapixels. Choose another JPG, PNG or WebP image.');
  }
}

/** Stores a sanitized image; returns its S3 key. */
export async function storeImage(image: { body: Buffer; contentType: string; extension: string }, key: string): Promise<string> {
  const fullKey = `${key}.${image.extension}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: fullKey, Body: image.body, ContentType: image.contentType }));
  return fullKey;
}

export async function loadImage(key: string): Promise<{ body: Buffer; contentType: string }> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!result.Body) throw new HttpError(404, 'Event image not found.');
  return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType || 'application/octet-stream' };
}
