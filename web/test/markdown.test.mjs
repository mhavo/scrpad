// The Markdown module against the cases of src/markdown.rs: the page must show and copy what the
// desktop app does. Needs `just web` first (it builds the module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadMarkdown, copyContents, clipboardItem } from "../src/markdown.js";

const wasm = await readFile(new URL("../dist/scrpad_crypto.wasm", import.meta.url));
const md = await loadMarkdown(wasm);

test("strips Markdown and keeps lines, list markers and tabbed tables", () => {
  assert.equal(md.strip("**bold** and *it* and ~~gone~~ and `code`\nnext line"), "bold and it and gone and code\nnext line");
  assert.equal(md.strip("# Title\n\nbody"), "Title\n\nbody");
  assert.equal(md.strip("[the docs](https://example.com) here"), "the docs here");
  assert.equal(md.strip("- one\n- two\n  - nested\n\n1. a\n2. b"), "- one\n- two\n  - nested\n\n1. a\n2. b");
  assert.equal(md.strip("- [x] done\n- [ ] todo"), "[x] done\n[ ] todo");
  assert.equal(md.strip("| a | b |\n|---|---|\n| 1 | 2 |"), "a\tb\n1\t2");
  const plain = "just a note\nwith two lines\n\nand a gap";
  assert.equal(md.strip(plain), plain);
  assert.equal(md.strip(""), "");
});

test("non-ASCII text survives both ways", () => {
  assert.equal(md.strip("**äö** 日本 😀"), "äö 日本 😀");
  assert.ok(md.html("# Åre").includes("<h1>Åre</h1>"));
});

test("HTML has the usual tags and hard line breaks", () => {
  const out = md.html("# Hi\n\n**b** and `c`\nnext\n\n- a\n- b");
  assert.ok(out.includes("<h1>Hi</h1>"), out);
  assert.ok(out.includes("<strong>b</strong> and <code>c</code><br />"), out);
  assert.ok(out.includes("<ul>") && out.includes("<li>a</li>"), out);
});

test("HTML never carries what a paste or the page could act on", () => {
  const out = md.html(
    "<script>alert(1)</script>\n\ntext <img src=x onerror=y>\n\n![alt](https://evil/x.png)\n\n[click](javascript:alert(1)) [ok](https://a.example) [m](mailto:a@b.c)",
  );
  assert.ok(!out.includes("<script") && !out.includes("<img"), out);
  assert.ok(out.includes("&lt;script&gt;"), out);
  assert.ok(!out.includes("javascript:") && !out.includes("evil"), out);
  assert.ok(out.includes('<a href="https://a.example">ok</a>') && out.includes('href="mailto:a@b.c"'), out);
});

test("the three copies", () => {
  const text = "# T\n\n**b**";
  assert.deepEqual(copyContents(md, text, "as-is"), { plain: text });
  assert.deepEqual(copyContents(md, text, "plain"), { plain: "T\n\nb" });
  assert.deepEqual(copyContents(md, text, "html"), { plain: "T\n\nb", html: md.html(text) });
});

test("the clipboard item holds the text form, and the HTML only for the HTML copy", async () => {
  class Item {
    constructor(parts) {
      this.parts = parts;
    }
  }
  const plainOnly = clipboardItem({ plain: "x" }, Item);
  assert.deepEqual(Object.keys(plainOnly.parts), ["text/plain"]);
  const both = clipboardItem({ plain: "x", html: "<b>x</b>" }, Item);
  assert.deepEqual(Object.keys(both.parts).sort(), ["text/html", "text/plain"]);
  assert.equal(await both.parts["text/html"].text(), "<b>x</b>");
});
