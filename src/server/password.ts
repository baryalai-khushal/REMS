import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// SRS v3 specifies exactly eight characters. Never trim passwords.
export function validPassword(password: string) {
  return [...password].length === 8 && Buffer.byteLength(password) <= 64;
}

export function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) return null;
  return username;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  if (!validPassword(password)) throw new Error("Password must contain exactly 8 characters.");
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// A missing username still performs the same expensive password operation.
const dummyHash = `scrypt$131072$8$1$${"00".repeat(16)}$${"00".repeat(64)}`;
export async function verifyPassword(password: string, encoded: string = dummyHash) {
  if (Buffer.byteLength(password) > 256) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$131072$8$1" ||
      !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const derived = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(derived, Buffer.from(parts[5], "hex"));
}
