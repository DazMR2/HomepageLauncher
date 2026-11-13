const path = require('node:path');

const ALLOWED_APP_PROTOCOLS = new Set([
  'ms-word:',
  'ms-excel:',
  'ms-powerpoint:',
  'outlook:',
  'msteams:'
]);

function validateHexColor(value, label = 'color') {
  if (typeof value !== 'string') {
    throw new TypeError(`Enter a ${label}.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!/^#[\da-f]{6}$/.test(normalized)) {
    throw new TypeError(`Use a valid ${label} in #RRGGBB format.`);
  }
  return normalized;
}

function validateTitle(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Enter a title.');
  }

  const title = value.trim();
  if (title.length < 1 || title.length > 50) {
    throw new RangeError('Titles must be between 1 and 50 characters.');
  }

  return title;
}

function normalizeSiteUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Enter a website address.');
  }

  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Website addresses must use HTTP or HTTPS and cannot contain credentials.');
  }

  return url.toString();
}

function validateAppTarget(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Choose an application or enter its target.');
  }

  const target = value.trim();
  if (target.length > 2048) {
    throw new RangeError('The application target is too long.');
  }

  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    if (url.username || url.password) {
      throw new TypeError('Website targets cannot contain credentials.');
    }
    return { target: url.toString(), kind: 'url' };
  }

  if (ALLOWED_APP_PROTOCOLS.has(target.toLowerCase())) {
    return { target: target.toLowerCase(), kind: 'protocol' };
  }

  if (path.win32.isAbsolute(target) && ['.exe', '.lnk'].includes(path.win32.extname(target).toLowerCase())) {
    return { target, kind: 'file' };
  }

  throw new TypeError('Use an HTTP(S) address, a supported Office/Teams link, or an absolute .exe/.lnk path.');
}

module.exports = { normalizeSiteUrl, validateAppTarget, validateHexColor, validateTitle };
