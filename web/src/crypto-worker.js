// Runs Argon2id off the page's thread. Messages: { id, op: "encrypt" | "decrypt", password, input }
// → { id, ok: true, output } or { id, ok: false, code, message }.
import { loadCrypto } from "./crypto.js";

const ready = fetch("scrpad_crypto.wasm")
  .then((r) => r.arrayBuffer())
  .then((bytes) => loadCrypto(bytes));

self.onmessage = async ({ data: { id, op, password, input } }) => {
  try {
    const c = await ready;
    self.postMessage({ id, ok: true, output: op === "encrypt" ? c.encrypt(password, input) : c.decrypt(password, input) });
  } catch (e) {
    self.postMessage({ id, ok: false, code: e.code ?? 0, message: e.message });
  }
};
