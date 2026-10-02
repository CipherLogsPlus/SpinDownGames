import { Buffer } from "node:buffer";
import { scrypt, timingSafeEqual } from "node:crypto";

// OWASP's scrypt profile with about 32 MiB of working memory per derivation.
// These parameters are part of the stored format, not a request-time option.
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = "$scrypt$v=1$N=32768,r=8,p=3$";
const HASH_PATTERN = /^\$scrypt\$v=1\$N=32768,r=8,p=3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

// Generated with a random password which was discarded. This is never stored
// for a user and never grants access. Compare against it for unknown accounts
// so their login path pays the same derivation cost as a registered account.
export const DUMMY_HASH = "$scrypt$v=1$N=32768,r=8,p=3$whJFULaFTVpMRhQC6g4rng$ROZhOKAZYrj1T7ELy18hgQoZzIh9RMYmZMKxH0IiCU0";

function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** The caller must validate UTF-8 password limits and rate limits first. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derive(password, salt);
  return `${PREFIX}${Buffer.from(salt).toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

/** Unsupported, noncanonical, or malformed stored encodings fail closed. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(encoded);
  if (!match) return false;
  const salt = Buffer.from(match[1], "base64url");
  const expected = Buffer.from(match[2], "base64url");
  // Buffer accepts some noncanonical encodings; exact re-encoding rejects them
  // and any trailing newline accepted by JavaScript's end-of-line anchor.
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES ||
      `${PREFIX}${salt.toString("base64url")}$${expected.toString("base64url")}` !== encoded) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
