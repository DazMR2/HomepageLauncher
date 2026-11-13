const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSiteUrl, validateAppTarget, validateHexColor, validateTitle } = require('../validation.cjs');

test('normalizes a bare website address to HTTPS', () => {
  assert.equal(normalizeSiteUrl('example.com/path'), 'https://example.com/path');
});

test('rejects non-web website protocols and embedded credentials', () => {
  assert.throws(() => normalizeSiteUrl('file:///C:/secret'), /HTTP or HTTPS/);
  assert.throws(() => normalizeSiteUrl('https://user:pass@example.com'), /credentials/);
});

test('validates app links and local Windows launch targets', () => {
  assert.deepEqual(validateAppTarget('ms-word:'), { target: 'ms-word:', kind: 'protocol' });
  assert.equal(validateAppTarget('https://copilot.microsoft.com').kind, 'url');
  assert.equal(validateAppTarget('C:\\Program Files\\Example\\app.exe').kind, 'file');
  assert.throws(() => validateAppTarget('C:\\Windows\\system32\\cmd.exe;bad'), /Use an HTTP/);
});

test('rejects unsupported app protocols and invalid titles', () => {
  assert.throws(() => validateAppTarget('javascript:alert(1)'), /Use an HTTP/);
  assert.throws(() => validateTitle('  '), /between 1 and 50/);
  assert.equal(validateTitle('  Outlook  '), 'Outlook');
});

test('validates background colors', () => {
  assert.equal(validateHexColor('#A1B2C3', 'background color'), '#a1b2c3');
  assert.throws(() => validateHexColor('blue', 'background color'), /#RRGGBB/);
});
