// SimpleTextCrypt through scrpad_crypto.wasm, built from the app's own src/crypto.rs.
// Argon2id takes seconds: the page calls this from crypto-worker.js, never on its own thread.

const ERRORS = {
  1: "Not an encrypted message",
  2: "Wrong password or corrupted message",
  3: "Password must not be empty",
};

export class CryptoError extends Error {
  constructor(code) {
    super(ERRORS[code] ?? `Encryption failed (${code})`);
    this.code = code;
  }
}

/** Instantiates the module from its bytes; `random` fills a Uint8Array with secure random bytes. */
export async function loadCrypto(bytes, random = (buf) => crypto.getRandomValues(buf)) {
  let wasm;
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      random_fill: (ptr, len) => random(new Uint8Array(wasm.memory.buffer, ptr, len)),
    },
  });
  wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const put = (string) => {
    const bytes = encoder.encode(string);
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    bytes.fill(0);
    return [ptr, bytes.length];
  };

  const call = (fn, password, input) => {
    const [pp, pl] = put(password);
    const [ip, il] = put(input);
    try {
      const code = fn(pp, pl, ip, il);
      if (code !== 0) throw new CryptoError(code);
      return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()).slice());
    } finally {
      wasm.out_clear();
      wasm.dealloc(pp, pl);
      wasm.dealloc(ip, il);
    }
  };

  return {
    encrypt: (password, text) => call(wasm.encrypt, password, text),
    decrypt: (password, message) => call(wasm.decrypt, password, message),
  };
}
