const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { UPLOAD_DIR, resolveUploadPath } = require('../utils/uploadStorage');

test('uses a dedicated upload root outside the route modules', () => {
  assert.ok(path.isAbsolute(UPLOAD_DIR));
});

test('resolves customer and provider upload URLs under the private root', () => {
  assert.equal(
    resolveUploadPath('/uploads/customers/42/profile-a.jpg'),
    path.join(UPLOAD_DIR, 'customers', '42', 'profile-a.jpg')
  );
  assert.equal(
    resolveUploadPath('/uploads/providers/17/document.pdf'),
    path.join(UPLOAD_DIR, 'providers', '17', 'document.pdf')
  );
});

test('rejects non-upload URLs and path traversal attempts', () => {
  assert.equal(resolveUploadPath('https://example.com/file.jpg'), null);
  assert.equal(resolveUploadPath('/uploads/../../.env'), null);
  assert.equal(resolveUploadPath('/uploads/'), null);
  assert.equal(resolveUploadPath(null), null);
});
