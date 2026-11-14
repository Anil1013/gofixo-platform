const path = require('node:path');

// Private customer and provider files live outside the deploy checkout.
// The default preserves local development compatibility.
const UPLOAD_DIR = path.resolve(
  process.env.GOFIXO_UPLOAD_DIR || path.join(__dirname, '..', 'uploads')
);

function resolveUploadPath(fileUrl) {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = fileUrl.slice('/uploads/'.length);
  if (!relativePath) return null;

  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return null;
  return resolved;
}

module.exports = { UPLOAD_DIR, resolveUploadPath };
