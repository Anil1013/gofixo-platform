const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUploadFile, detectFileMime } = require('../utils/fileValidation');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const webp = Buffer.from('RIFF0000WEBP', 'ascii');
const pdf = Buffer.from('%PDF-1.7\n', 'ascii');

test('detects supported file signatures', () => {
  assert.equal(detectFileMime(png), 'image/png');
  assert.equal(detectFileMime(jpeg), 'image/jpeg');
  assert.equal(detectFileMime(webp), 'image/webp');
  assert.equal(detectFileMime(pdf), 'application/pdf');
  assert.equal(detectFileMime(Buffer.from('not an image')), null);
});

test('accepts a real image when extension and reported MIME match', () => {
  assert.equal(validateUploadFile({
    originalname: 'profile.jpg',
    mimetype: 'image/jpeg',
    buffer: jpeg,
  }, new Set(['image/jpeg'])), true);
});

test('rejects a renamed executable or mismatched image extension', () => {
  assert.equal(validateUploadFile({
    originalname: 'profile.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('MZ executable'),
  }, new Set(['image/jpeg'])), false);
  assert.equal(validateUploadFile({
    originalname: 'profile.png',
    mimetype: 'image/png',
    buffer: jpeg,
  }, new Set(['image/png', 'image/jpeg'])), false);
});

test('accepts generic Android MIME only when the file signature is valid', () => {
  assert.equal(validateUploadFile({
    originalname: 'document.pdf',
    mimetype: 'application/octet-stream',
    buffer: pdf,
  }, new Set(['application/pdf'])), true);
});
