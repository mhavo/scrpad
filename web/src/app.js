// The page: the dropdown of notes, the editor, the eye and the lock, autosave and sealing.
// The model is notes.js; Argon2id runs in crypto-worker.js; storage.js keeps the notes.
import * as N from "./notes.js";
import * as storage from "./storage.js";
import * as M from "./markdown.js";

const $ = (id) => document.getElementById(id);
const ui = {
  note: $("note"),
  eye: $("eye"),
  lock: $("lock"),
  copy: $("copy"),
  copyMore: $("copy-more"),
  copyMenu: $("copy-menu"),
  rendered: $("rendered"),
  more: $("more"),
  editor: $("editor"),
  masked: $("masked"),
  unlock: $("unlock"),
  unlockPassword: $("unlock-password"),
  unlockError: $("unlock-error"),
  cipher: $("cipher"),
  status: $("status"),
  toast: $("toast"),
  menu: $("menu"),
  encrypt: $("encrypt-dialog"),
  pw1: $("pw1"),
  pw2: $("pw2"),
  encryptError: $("encrypt-error"),
  rename: $("rename-dialog"),
  title: $("title"),
  importFile: $("import-file"),
};

const SEAL_AFTER_MS = 1500;
const SAVE_AFTER_MS = 400;
const TOAST_MS = 6000;
/** The dropdown's last entry: it adds a note instead of choosing one. */
const NEW_NOTE = "new";

let state = N.defaultState();
/** Per page view, not saved: the encrypted text is on screen instead of the editor. */
let showCipher = false;
/** Per page view, not saved: the ids of the notes shown formatted (Markdown) instead of as text. */
const formatted = new Set();
/** The Markdown module, once it has loaded (it is the crypto module's wasm, see markdown.js). */
let md = null;

// ---------------------------------------------------------------- the crypto worker

/** One worker, its jobs in order; ended after a minute without work to give back Argon2's 64 MiB. */
const sealer = {
  worker: null,
  jobs: new Map(),
  seq: 0,
  timer: 0,
  run(op, password, input) {
    clearTimeout(this.timer);
    if (!this.worker) {
      this.worker = new Worker("crypto-worker.js", { type: "module" });
      this.worker.onmessage = ({ data }) => {
        const job = this.jobs.get(data.id);
        this.jobs.delete(data.id);
        if (data.ok) job.resolve(data.output);
        else job.reject(Object.assign(new Error(data.message), { code: data.code }));
        this.idle();
      };
      this.worker.onerror = () => this.fail(new Error("Encryption is not available in this browser"));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, password, input });
    });
  },
  fail(error) {
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
    this.worker?.terminate();
    this.worker = null;
  },
  idle() {
    if (this.jobs.size) return;
    this.timer = setTimeout(() => {
      this.worker?.terminate();
      this.worker = null;
    }, 60_000);
  },
};

const needsSeal = (n) => N.isEncrypted(n) && !N.isLocked(n) && n.text !== n.sealed;

/** Encrypts the note's text as it is now, after any seal already running for it. */
function sealNow(note) {
  const text = note.text;
  const password = note.password;
  const job = (note.sealing ?? Promise.resolve())
    .catch(() => {})
    .then(() => sealer.run("encrypt", password, text))
    .then((cipher) => {
      note.cipher = cipher;
      if (note.password === password) note.sealed = text;
    });
  note.sealing = job;
  job.then(
    () => note.sealing === job && (note.sealing = null),
    () => note.sealing === job && (note.sealing = null),
  );
  return job;
}

/** Seals and saves; on failure the edits stay dirty and the status line says so. */
async function sealAndSave(note) {
  clearTimeout(note.sealTimer);
  if (!needsSeal(note)) return true;
  try {
    await sealNow(note);
    sealError = null;
    changed(0);
    return true;
  } catch (e) {
    sealError = e;
    updateStatus();
    return false;
  }
}

function scheduleSeal(note) {
  clearTimeout(note.sealTimer);
  note.sealTimer = setTimeout(() => sealAndSave(note), SEAL_AFTER_MS);
}

// ---------------------------------------------------------------- saving

let saveTimer = 0;
let dirty = false;
let saveError = null;
let sealError = null;
let persistAsked = false;

function changed(delay = SAVE_AFTER_MS) {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, delay);
  updateStatus();
}

/** Writes a snapshot of the notes; encrypted ones only as their cipher (notes.js toStored). */
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    await storage.save(N.toStored(state));
    saveError = null;
    if (!persistAsked) {
      persistAsked = true;
      persisted = await storage.persist();
    }
  } catch (e) {
    dirty = true;
    saveError = e;
    saveTimer = setTimeout(flush, 5000);
  }
  updateStatus();
}

let persisted = false;

function updateStatus() {
  const sealing = state.notes.some((n) => needsSeal(n) || n.sealing || n.locking);
  let text = "";
  if (saveError) text = `Not saved: ${saveError.message || saveError}. The changes are kept here; trying again.`;
  else if (sealError) text = `Not encrypted yet: ${sealError.message}. The last encrypted version is the one saved.`;
  else if (sealing) text = "Encrypting…";
  ui.status.textContent = text;
  ui.status.classList.toggle("error", Boolean(saveError || sealError));
  ui.status.hidden = !text;
}

// ---------------------------------------------------------------- drawing

const current = () => state.notes[state.active];

function icon(button, name) {
  const i = button.querySelector(".icon");
  if (i.dataset.icon !== name) i.dataset.icon = name;
  i.style.setProperty("--src", `url("icons/${name}.svg")`);
}

function applyLook() {
  const dark = state.theme === "Dark" || (state.theme === "System" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.font = state.font;
  document.documentElement.style.setProperty("--font-size", `${state.font_size}px`);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#2a2c30" : "#fbfbfa";
}

function render() {
  const note = current();
  const options = state.notes.map((n, i) => new Option(N.label(n), String(i), false, i === state.active));
  ui.note.replaceChildren(...options, new Option("New note", NEW_NOTE));
  ui.note.value = String(state.active);

  const locked = N.isLocked(note);
  const cipherView = showCipher && N.isEncrypted(note);
  const masked = N.isMasked(note) && !locked && !cipherView;
  const editing = !locked && !masked && !cipherView;

  // A masked, locked or cipher view never gets here: only a note the editor would show.
  const formattedView = editing && formatted.has(note.id) && md !== null;
  ui.editor.hidden = !editing || formattedView;
  ui.editor.readOnly = Boolean(note.locking);
  if (editing && ui.editor.value !== note.text) ui.editor.value = note.text;
  if (!editing) ui.editor.value = "";
  ui.rendered.hidden = !formattedView;
  if (formattedView) showFormatted(note.text);
  else ui.rendered.replaceChildren();
  ui.masked.hidden = !masked;
  ui.masked.textContent = masked ? N.mask(note.text) || "Hidden note" : "";
  ui.unlock.hidden = !locked || cipherView;
  ui.cipher.hidden = !cipherView;
  ui.cipher.value = cipherView ? note.cipher : "";

  icon(ui.eye, note.hidden && !note.revealed ? "eye-off" : "eye");
  ui.eye.classList.toggle("on", Boolean(note.hidden && note.revealed));
  ui.eye.setAttribute("aria-label", !note.hidden ? "Hide note" : note.revealed ? "Hide note again" : "Reveal note");
  ui.eye.title = ui.eye.getAttribute("aria-label");
  icon(ui.lock, locked ? "lock" : "lock-open");
  ui.lock.classList.toggle("secure", N.isEncrypted(note));
  ui.lock.setAttribute("aria-label", locked ? "Unlock note" : N.isEncrypted(note) ? "Lock note" : "Encrypt note");
  ui.lock.title = ui.lock.getAttribute("aria-label");
  ui.copy.disabled = ui.copyMore.disabled = locked && !cipherView;
  updateStatus();
}

// ---------------------------------------------------------------- toasts

let toastTimer = 0;
function toast(message, action, run) {
  clearTimeout(toastTimer);
  ui.toast.querySelector("span").textContent = message;
  const button = ui.toast.querySelector("button");
  button.textContent = action ?? "";
  button.onclick = () => {
    ui.toast.hidden = true;
    run?.();
  };
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => (ui.toast.hidden = true), TOAST_MS);
}

// ---------------------------------------------------------------- actions

function selectNote(i) {
  state.active = i;
  showCipher = false;
  render();
  changed();
}

function addNote() {
  N.addNote(state);
  showCipher = false;
  render();
  changed();
  ui.editor.focus();
}

function clickEye() {
  const note = current();
  N.clickEye(note);
  render();
  changed();
  if (note.revealed) toast("Revealed for now", "Keep visible", () => keepVisible(note));
}

function keepVisible(note) {
  N.keepVisible(note);
  render();
  changed();
  toast("This note is visible again", "Undo", () => {
    note.hidden = true;
    note.revealed = true;
    render();
    changed();
  });
}

async function clickLock() {
  const note = current();
  if (N.isLocked(note)) return ui.unlockPassword.focus();
  if (N.isEncrypted(note)) return lockNote(note);
  ui.pw1.value = ui.pw2.value = "";
  ui.encryptError.textContent = "";
  ui.encrypt.showModal();
}

async function encryptNote(note, password) {
  const text = note.text;
  note.locking = true;
  render();
  try {
    note.cipher = await sealer.run("encrypt", password, text);
    note.password = password;
    note.sealed = text;
    changed(0);
  } catch (e) {
    toast(`Not encrypted: ${e.message}`);
  }
  note.locking = false;
  render();
}

/** Seals what was typed, then drops the text and password; on a failed seal nothing is dropped. */
async function lockNote(note) {
  if (!N.isEncrypted(note) || N.isLocked(note) || note.locking) return;
  note.locking = true;
  render();
  const sealed = needsSeal(note) ? await sealAndSave(note) : true;
  if (note.sealing) await note.sealing.catch(() => {});
  note.locking = false;
  if (sealed && !needsSeal(note)) {
    note.text = "";
    note.password = null;
    note.sealed = undefined;
    note.revealed = false;
  }
  render();
  await flush();
}

async function lockAll() {
  await Promise.all(state.notes.map(lockNote));
}

async function unlock(event) {
  event.preventDefault();
  const note = current();
  const password = ui.unlockPassword.value;
  if (!password) return;
  const button = ui.unlock.querySelector("button");
  button.disabled = true;
  button.textContent = "Unlocking…";
  ui.unlockError.textContent = "";
  try {
    if (note.sealing) await note.sealing.catch(() => {});
    const text = await sealer.run("decrypt", password, note.cipher);
    note.text = text;
    note.sealed = text;
    note.password = password;
    ui.unlockPassword.value = "";
    render();
    if (!N.isMasked(note)) ui.editor.focus();
  } catch (e) {
    ui.unlockError.textContent = e.code === 2 ? "Wrong password" : e.message;
    ui.unlockPassword.select();
  } finally {
    button.disabled = false;
    button.textContent = "Unlock";
  }
}

function removeEncryption() {
  const note = current();
  if (N.isLocked(note)) return;
  clearTimeout(note.sealTimer);
  delete note.cipher;
  note.password = null;
  note.sealed = undefined;
  showCipher = false;
  render();
  changed(0);
  toast("Encryption removed: the note is saved as plain text");
}

/** The module's HTML is already safe; links open in a new tab and tell the site nothing. */
function showFormatted(text) {
  const doc = new DOMParser().parseFromString(md.html(text), "text/html");
  for (const a of doc.querySelectorAll("a")) a.setAttribute("rel", "noopener noreferrer"), a.setAttribute("target", "_blank");
  ui.rendered.replaceChildren(...doc.body.childNodes);
}

function toggleFormatted(note) {
  if (md === null) return toast("Markdown is not available yet");
  if (!formatted.delete(note.id)) formatted.add(note.id);
  render();
}

async function copyNote(format = "as-is") {
  const note = current();
  const cipherView = showCipher && N.isEncrypted(note);
  if (N.isLocked(note) && !cipherView) return;
  try {
    if (cipherView || format === "as-is") {
      await navigator.clipboard.writeText(cipherView ? note.cipher : note.text);
    } else {
      if (md === null) return toast("Markdown is not available yet");
      const contents = M.copyContents(md, note.text, format);
      if (contents.plain === "") return toast("Nothing to copy");
      if (format === "html" && !(globalThis.ClipboardItem && navigator.clipboard.write)) return toast("This browser can't copy as HTML");
      if (format === "html") await navigator.clipboard.write([M.clipboardItem(contents)]);
      else await navigator.clipboard.writeText(contents.plain);
    }
    const secret = (note.hidden || N.isEncrypted(note)) && !cipherView;
    toast(secret ? "Copied. Clear the clipboard yourself when done: a browser cannot." : "Copied");
  } catch {
    toast("The browser did not allow copying");
  }
}

function clearNote() {
  const note = current();
  if (N.isLocked(note) || note.text === "") return;
  const before = note.text;
  note.text = "";
  afterEdit(note);
  render();
  toast("Cleared", "Undo", () => {
    if (note.text !== "" || N.isLocked(note)) return;
    note.text = before;
    afterEdit(note);
    render();
  });
}

function deleteNote() {
  const undo = N.removeNote(state, state.active);
  clearTimeout(undo.note.sealTimer);
  showCipher = false;
  render();
  changed(0);
  let restored = false;
  toast(`Deleted “${undo.note.title}”`, "Undo", () => {
    restored = true;
    N.restoreNote(state, undo);
    render();
    changed(0);
  });
  // The undo keeps an unlocked note's text and password only as long as the toast.
  setTimeout(() => {
    if (!restored) undo.note = null;
  }, TOAST_MS + 500);
}

function fileName(title, ext) {
  return `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "note"}.${ext}`;
}

/** The share sheet where there is one (phones: Save to Files, Drive…), else a download. */
async function hand(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function saveNote() {
  const note = current();
  // An encrypted note leaves as its encrypted message, never as plaintext.
  if (N.isEncrypted(note)) {
    if (needsSeal(note)) return toast("Still encrypting; try again in a moment");
    return hand(fileName(note.title, "txt"), note.cipher, "text/plain");
  }
  hand(fileName(note.title, "txt"), note.text, "text/plain");
}

function backup() {
  if (state.notes.some(needsSeal)) return toast("Still encrypting; try again in a moment");
  hand("notes.json", JSON.stringify(N.toBackup(state), null, 2), "application/json");
}

async function importFile() {
  const file = ui.importFile.files[0];
  ui.importFile.value = "";
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!Array.isArray(raw?.notes)) throw new Error("no notes");
    const count = N.importNotes(state, raw);
    render();
    changed(0);
    toast(count ? `Imported ${count} note${count === 1 ? "" : "s"}` : "No notes with text in that file");
  } catch {
    toast("That is not a scrpad notes.json");
  }
}

function afterEdit(note) {
  changed();
  if (N.isEncrypted(note)) scheduleSeal(note);
}

// ---------------------------------------------------------------- the … menu

function openMenu() {
  const note = current();
  const when = {
    hidden: note.hidden,
    encrypted: N.isEncrypted(note),
    unlocked: N.isEncrypted(note) && !N.isLocked(note),
    editable: !N.isLocked(note) && !N.isMasked(note) && !(showCipher && N.isEncrypted(note)),
  };
  for (const b of ui.menu.querySelectorAll("[data-when]")) b.hidden = !when[b.dataset.when];
  ui.menu.querySelector('[value="show-cipher"]').textContent = showCipher ? "Hide encrypted text" : "Show encrypted text";
  ui.menu.querySelector('[value="render"]').textContent = formatted.has(note.id) ? "Edit as text" : "Show formatted";
  ui.menu.querySelector('[value="clear"]').disabled = N.isLocked(note);
  $("auto-lock").checked = state.auto_lock;
  $("auto-rehide").checked = state.auto_rehide;
  for (const b of ui.menu.querySelectorAll("[data-font]")) b.classList.toggle("on", b.dataset.font === state.font);
  for (const b of ui.menu.querySelectorAll("[data-theme-choice]")) b.classList.toggle("on", b.dataset.themeChoice === state.theme);
  ui.menu.returnValue = "";
  $("persisted").textContent = persisted
    ? "The browser keeps them even when space runs low."
    : "The browser may clear them when space runs low: back them up now and then.";
  ui.menu.showModal();
}

/** Settings apply in place and keep the menu open; the rest close it first. */
function menuClick(event) {
  const button = event.target.closest("button");
  if (event.target === ui.menu) return ui.menu.close();
  if (!button) return;
  const v = button.value;
  if (v.startsWith("font-")) state.font = v.slice(5);
  else if (v.startsWith("theme-")) state.theme = v.slice(6);
  else if (v === "smaller") state.font_size = Math.max(12, state.font_size - 1);
  else if (v === "larger") state.font_size = Math.min(28, state.font_size + 1);
  else return;
  event.preventDefault();
  applyLook();
  changed();
  openMenuRefresh();
}

function openMenuRefresh() {
  for (const b of ui.menu.querySelectorAll("[data-font]")) b.classList.toggle("on", b.dataset.font === state.font);
  for (const b of ui.menu.querySelectorAll("[data-theme-choice]")) b.classList.toggle("on", b.dataset.themeChoice === state.theme);
}

function menuAction(value) {
  const note = current();
  switch (value) {
    case "rename":
      ui.title.value = note.title;
      ui.rename.showModal();
      ui.title.select();
      break;
    case "render":
      toggleFormatted(note);
      break;
    case "visible":
      keepVisible(note);
      break;
    case "show-cipher":
      showCipher = !showCipher;
      render();
      break;
    case "remove-encryption":
      removeEncryption();
      break;
    case "save":
      saveNote();
      break;
    case "clear":
      clearNote();
      break;
    case "delete":
      deleteNote();
      break;
    case "lock-all":
      lockAll();
      break;
    case "backup":
      backup();
      break;
    case "import":
      ui.importFile.click();
      break;
  }
}

// ---------------------------------------------------------------- stepping away

let lastInput = Date.now();
const touched = () => (lastInput = Date.now());

/** Page hidden or idle: save, hide revealed notes again, lock encrypted ones (as the options say). */
async function stepAway() {
  if (state.auto_rehide) {
    N.rehideAll(state);
    render();
  }
  await Promise.all(state.notes.filter(needsSeal).map(sealAndSave));
  await flush();
  if (state.auto_lock) await lockAll();
}

// ---------------------------------------------------------------- start

/** Loads in the background; the formatted view and the copies that need it wait for it. */
async function loadMarkdown() {
  try {
    md = await M.loadMarkdown(await (await fetch("scrpad_crypto.wasm")).arrayBuffer());
    render();
  } catch {
    // Without it the page is a plain editor with the plain copy.
  }
}

async function start() {
  try {
    const stored = await storage.load();
    // Something there but not notes: kept aside before anything is saved over it.
    if (stored != null && !Array.isArray(stored.notes)) await storage.keepAside(stored);
    state = stored ? N.fromStored(stored) : N.defaultState();
  } catch (e) {
    // Never start over a store that could not be read: nothing is saved until a reload works.
    document.body.replaceChildren(Object.assign(document.createElement("p"), { className: "center error", textContent: `Could not read the notes: ${e.message || e}. Nothing was changed; reload to try again.` }));
    return;
  }
  for (const i of document.querySelectorAll(".icon[data-icon]")) i.style.setProperty("--src", `url("icons/${i.dataset.icon}.svg")`);
  applyLook();
  render();
  loadMarkdown();

  ui.note.onchange = () => (ui.note.value === NEW_NOTE ? addNote() : selectNote(Number(ui.note.value)));
  ui.eye.onclick = clickEye;
  ui.lock.onclick = clickLock;
  ui.copy.onclick = () => copyNote();
  ui.copyMore.onclick = () => {
    ui.copyMenu.returnValue = "";
    ui.copyMenu.showModal();
  };
  ui.copyMenu.addEventListener("click", (e) => e.target === ui.copyMenu && ui.copyMenu.close());
  ui.copyMenu.addEventListener("close", () => M.COPY_FORMATS.includes(ui.copyMenu.returnValue) && copyNote(ui.copyMenu.returnValue));
  ui.more.onclick = openMenu;
  ui.masked.onclick = clickEye;
  ui.masked.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), clickEye());
  ui.unlock.onsubmit = unlock;
  ui.editor.oninput = () => {
    const note = current();
    note.text = ui.editor.value;
    afterEdit(note);
  };
  ui.menu.addEventListener("click", menuClick);
  ui.menu.addEventListener("close", () => menuAction(ui.menu.returnValue));
  $("auto-lock").onchange = (e) => {
    state.auto_lock = e.target.checked;
    changed();
  };
  $("auto-rehide").onchange = (e) => {
    state.auto_rehide = e.target.checked;
    changed();
  };
  ui.encrypt.querySelector("form").onsubmit = (e) => {
    if (e.submitter?.value !== "ok") return;
    if (!ui.pw1.value) {
      e.preventDefault();
      ui.encryptError.textContent = "Enter a password";
    } else if (ui.pw1.value !== ui.pw2.value) {
      e.preventDefault();
      ui.encryptError.textContent = "The passwords differ";
    } else {
      encryptNote(current(), ui.pw1.value);
    }
  };
  ui.encrypt.addEventListener("close", () => (ui.pw1.value = ui.pw2.value = ""));
  ui.rename.querySelector("form").onsubmit = (e) => {
    if (e.submitter?.value === "cancel") return;
    const title = ui.title.value.trim();
    if (!title) return e.preventDefault();
    current().title = title;
    render();
    changed();
  };
  ui.importFile.onchange = importFile;
  for (const b of document.querySelectorAll("[data-close]")) b.onclick = () => b.closest("dialog").close();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyLook);

  for (const type of ["keydown", "pointerdown", "input"]) addEventListener(type, touched, { capture: true, passive: true });
  setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastInput > N.IDLE_MS) {
      touched();
      stepAway();
    }
  }, 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stepAway();
  });
  addEventListener("pagehide", () => flush());

  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
