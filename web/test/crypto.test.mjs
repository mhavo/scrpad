// The wasm module against the same vectors as src/crypto.rs: other SimpleTextCrypt tools must
// read what the web app writes. Needs `just web` first (it builds the module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadCrypto, CryptoError } from "../src/crypto.js";

const root = new URL("../../", import.meta.url);
const wasm = await readFile(new URL("web/dist/scrpad_crypto.wasm", root));
const vectors = JSON.parse(await readFile(new URL("tests/data/simpletextcrypt-vectors.json", root), "utf8"));
const iv = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));

test("vectors encrypt bit-exact with their IV", async () => {
  for (const v of vectors) {
    const c = await loadCrypto(wasm, (buf) => buf.set(iv(v.ivHex)));
    assert.equal(c.encrypt(v.password, v.plaintext), v.message);
  }
});

test("vectors decrypt", async () => {
  const c = await loadCrypto(wasm);
  for (const v of vectors) assert.equal(c.decrypt(v.password, v.message), v.plaintext);
});

test("a real Android message decrypts, whitespace mangled", async () => {
  const c = await loadCrypto(wasm);
  const pw = "aurinkoistapäivääteillekaikille";
  assert.equal(c.decrypt(pw, "  +B8950Qof ZjSTcB0 o8rT3U6yY0CSmobkU1aMW3cKHH/O\r\n bMsxi5qDGQHHy580pj4tTQ==  \n"), "Juankoski here i come");
});

test("random IVs round-trip; errors carry their code", async () => {
  const c = await loadCrypto(wasm);
  const text = "Hei maailma, ääkköset ja 😜".repeat(10);
  const a = c.encrypt("password", text);
  assert.notEqual(a, c.encrypt("password", text));
  assert.equal(c.decrypt("password", a), text);
  assert.throws(() => c.decrypt("wrong", a), (e) => e instanceof CryptoError && e.code === 2);
  assert.throws(() => c.encrypt("", "x"), (e) => e.code === 3);
  assert.throws(() => c.decrypt("pw", "hei maailma"), (e) => e.code === 1);
});
