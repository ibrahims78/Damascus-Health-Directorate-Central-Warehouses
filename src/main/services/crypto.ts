import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * تشفير الحقول الحساسة (مثل الرقم الوطني) بـ AES-256-GCM.
 * المفتاح مشتق من سرّ الجهاز + كلمة مرور التطبيق، ومخزَّن بصلاحيات مقيدة.
 */

const SCRYPT_KEYLEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** تجزئة كلمة المرور — scrypt مع ملح عشوائي لكل مستخدم. */
export function hashPassword(password: string): { hash: string; salt: string; algo: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return { hash, salt, algo: 'scrypt' };
}

export function verifyPassword(password: string, hash: string, salt: string, algo: string): boolean {
  if (algo !== 'scrypt') return false;
  const candidate = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function deriveKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
}

/** إرجاع سلسلة جاهزة للتخزين: v1:<iv>:<tag>:<cipher> (كلها base64). */
export async function encryptField(plain: string, key: Buffer): Promise<string> {
  const { createCipheriv } = await import('node:crypto');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export async function decryptField(payload: string, key: Buffer): Promise<string | null> {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const { createDecipheriv } = await import('node:crypto');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
