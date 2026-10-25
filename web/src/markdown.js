// Markdown through the same scrpad_crypto.wasm, built from the app's own src/markdown.rs: the
// formatted view and the three copies come out exactly as in the desktop app. What it answers
// is safe to show: raw HTML is escaped, images are their alt text, and only http, https and
// mailto links stay links.

/** Instantiates the module from its bytes (the crypto exports ride along, unused here). */
export async function loadMarkdown(bytes) {
  let wasm;
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { random_fill: (ptr, len) => crypto.getRandomValues(new Uint8Array(wasm.memory.buffer, ptr, len)) },
  });
  wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const call = (fn, text) => {
    const bytes = encoder.encode(text);
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    bytes.fill(0);
    try {
      if (fn(ptr, bytes.length) !== 0) throw new Error("Not valid text");
      return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()).slice());
    } finally {
      wasm.out_clear();
      wasm.dealloc(ptr, bytes.length);
    }
  };

  return {
    html: (text) => call(wasm.md_html, text),
    strip: (text) => call(wasm.md_strip, text),
  };
}

export const COPY_FORMATS = ["as-is", "plain", "html"];

/** What a copy puts on the clipboard: `{ plain, html }`, with `html` only for the HTML copy. */
export function copyContents(md, text, format) {
  if (format === "as-is") return { plain: text };
  const plain = md.strip(text);
  return format === "html" ? { plain, html: md.html(text) } : { plain };
}

/** The copy as the browser's clipboard takes it: one item, in the forms it has. */
export function clipboardItem({ plain, html }, ClipboardItemClass = globalThis.ClipboardItem) {
  const parts = { "text/plain": new Blob([plain], { type: "text/plain" }) };
  if (html !== undefined) parts["text/html"] = new Blob([html], { type: "text/html" });
  return new ClipboardItemClass(parts);
}
