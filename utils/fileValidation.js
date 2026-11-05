const path = require('path');

const EXTENSION_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.pdf', 'application/pdf'],
]);

function detectFileMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function validateUploadFile(file, allowedMimeTypes) {
  if (!file || !Buffer.isBuffer(file.buffer)) return false;
  const extensionMime = EXTENSION_MIME.get(path.extname(file.originalname || '').toLowerCase());
  const detectedMime = detectFileMime(file.buffer);
  const reportedMime = String(file.mimetype || '').toLowerCase();
  if (!extensionMime || !detectedMime || extensionMime !== detectedMime) return false;
  if (!allowedMimeTypes.has(detectedMime)) return false;
  if (reportedMime && reportedMime !== 'application/octet-stream' && reportedMime !== detectedMime) return false;
  return true;
}

module.exports = { detectFileMime, validateUploadFile };
