const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256Base64Url(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqualText(leftValue, rightValue, encoding = 'utf8') {
  try {
    const left = Buffer.from(String(leftValue || ''), encoding);
    const right = Buffer.from(String(rightValue || ''), encoding);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch (error) {
    return false;
  }
}

module.exports = { sha256Hex, hmacSha256Base64Url, timingSafeEqualText };
