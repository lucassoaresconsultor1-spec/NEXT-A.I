import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt from node:crypto (no native addon). Parameters follow the OWASP
// Password Storage Cheat Sheet option N=2^16, r=8, p=2 (~64 MiB per hash).
// The encoded hash keeps its own parameters so they can be raised later.

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 16, r: 8, p: 2 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// Upper bound for parameters read back from storage, so a corrupted row cannot exhaust memory.
const MAX_N = 2 ** 20;

function derive(password: string, salt: Buffer, params: ScryptParams) {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

function parse(encoded: string) {
  const [scheme, n, r, p, salt, key] = encoded.split("$");
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    scheme === "scrypt" &&
    Number.isInteger(params.N) && params.N > 1 && params.N <= MAX_N && (params.N & (params.N - 1)) === 0 &&
    Number.isInteger(params.r) && params.r > 0 && params.r <= 32 &&
    Number.isInteger(params.p) && params.p > 0 && params.p <= 16 &&
    Boolean(salt) && Boolean(key);
  return valid ? { params, salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") } : null;
}

export async function verifyPassword(password: string, encoded: string) {
  const parsed = parse(encoded);
  if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
  const candidate = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/** Spend the same work when the account does not exist, to avoid user enumeration by timing. */
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummyHash);
  return false;
}
