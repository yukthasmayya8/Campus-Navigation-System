const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { badRequest } = require('../utils/errors');
const { sniffImage } = require('../utils/image');

/**
 * Storage driver interface: saveImage(buffer) -> { url }.
 * "local" writes to UPLOAD_DIR (development only: hosted free tiers often wipe local disks).
 * For the hosted demo, add a driver here (Supabase Storage / Cloudinary / S3) that returns an https URL;
 * nothing else in the code changes because only the URL is stored in PostgreSQL.
 */
async function saveImage(buffer) {
  const type = sniffImage(buffer);
  if (!type) throw badRequest('File is not a valid JPEG, PNG or WebP image');
  if (buffer.length > config.maxImageBytes) throw badRequest('Image is too large');
  const name = `${crypto.randomUUID()}.${type.ext}`; // server-generated name; user path never used
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, name), buffer, { flag: 'wx' });
  return { url: `${config.publicBaseUrl}/uploads/${name}`, mime: type.mime, size: buffer.length };
}
module.exports = { saveImage };
