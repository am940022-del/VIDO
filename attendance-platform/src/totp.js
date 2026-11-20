'use strict';
/*
 * رموز التحقق بخطوتين (TOTP, RFC 6238): 6 أرقام كل 30 ثانية، HMAC-SHA1.
 * متوافقة مع Google Authenticator و Microsoft Authenticator و Authy وغيرها.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 بت
}

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/**
 * يتحقق من الرمز مع سماح ±30 ثانية لفرق الساعة.
 * يعيد رقم الخطوة المطابقة (لمنع إعادة استخدام نفس الرمز) أو null.
 */
function verify(secret, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const d of [0, -1, 1]) {
    const step = cur + d;
    if (step <= lastStep) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

function otpauthUrl(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/** رموز استرداد للاستخدام مرة واحدة إن فُقد الجوال */
function recoveryCodes(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // بدون الأحرف المتشابهة (l/1، o/0، i)
  return Array.from({ length: n }, () => {
    const s = Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

module.exports = { generateSecret, verify, codeAt, otpauthUrl, recoveryCodes, hashCode, base32Encode, base32Decode };
