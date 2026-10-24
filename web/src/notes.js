// The notes, UI-free: the same model and file format as src/store.rs, so a backup opens in the
// desktop app and its notes.json imports here.
//
// A note in memory: { id, title, text, hidden, cipher, password?, revealed?, sealed? }
// - hidden: masked on screen; `revealed` shows it for now, and it is still saved as hidden.
// - cipher: the SimpleTextCrypt message; set means encrypted, and `text` never reaches storage.
// - password: only while unlocked. `sealed` is the text `cipher` holds, to tell unsaved edits.

export const IDLE_MS = 5 * 60 * 1000;
export const THEMES = ["System", "Dark", "Light"];

export function defaultState() {
  return fixUp({
    notes: [],
    active: 0,
    theme: "System",
    font: "Sans",
    font_size: 16,
    next_id: 1,
    auto_lock: true,
    auto_rehide: true,
  });
}

const isEncrypted = (note) => typeof note.cipher === "string";
export const isLocked = (note) => isEncrypted(note) && note.password == null;
export { isEncrypted };

/** Reads stored or imported JSON (notes.json from the desktop app included); never throws on odd fields. */
export function fromStored(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.notes)) return base;
  const state = {
    ...base,
    notes: raw.notes.filter((n) => n && typeof n === "object").map(noteFromStored),
    active: Number.isInteger(raw.active) ? raw.active : 0,
    next_id: Number.isInteger(raw.next_id) ? raw.next_id : 1,
  };
  if (THEMES.includes(raw.theme)) state.theme = raw.theme;
  if (raw.font === "Sans" || raw.font === "Mono") state.font = raw.font;
  if (typeof raw.font_size === "number" && raw.font_size >= 10 && raw.font_size <= 32) state.font_size = raw.font_size;
  if (typeof raw.auto_lock === "boolean") state.auto_lock = raw.auto_lock;
  if (typeof raw.auto_rehide === "boolean") state.auto_rehide = raw.auto_rehide;
  return fixUp(state);
}

function noteFromStored(n) {
  const cipher = typeof n.cipher === "string" ? n.cipher : undefined;
  return {
    id: Number.isInteger(n.id) ? n.id : 0,
    title: typeof n.title === "string" && n.title.trim() ? n.title : "Untitled",
    // An encrypted note starts locked: whatever text it came with goes.
    text: cipher === undefined && typeof n.text === "string" ? n.text : "",
    hidden: n.hidden === true,
    ...(cipher === undefined ? {} : { cipher }),
  };
}

/** What storage and backups get: an encrypted note only as its cipher, with "" as its text. */
export function toStored(state) {
  return {
    notes: state.notes.map((n) => ({
      id: n.id,
      title: n.title,
      text: isEncrypted(n) ? "" : n.text,
      hidden: n.hidden,
      ...(isEncrypted(n) ? { cipher: n.cipher } : {}),
    })),
    active: state.active,
    theme: state.theme,
    font: state.font,
    font_size: state.font_size,
    next_id: state.next_id,
    auto_lock: state.auto_lock,
    auto_rehide: state.auto_rehide,
  };
}

/** A notes.json for the desktop app: its own theme names, so it loads there as it is. */
export function toBackup(state) {
  const { notes, active, next_id, auto_lock, auto_rehide } = toStored(state);
  const font = state.font;
  return { notes, active, next_id, auto_lock, auto_rehide, font, font_size: state.font_size };
}

/** At least one note, a valid active index, unique non-zero ids that are never reused. */
export function fixUp(state) {
  if (state.notes.length === 0) state.notes.push(newNote(state, "Scratchpad 1"));
  state.active = Math.max(0, Math.min(state.active, state.notes.length - 1));
  const seen = new Set();
  for (const note of state.notes) {
    if (note.id <= 0 || seen.has(note.id)) note.id = 0;
    else seen.add(note.id);
  }
  state.next_id = Math.max(state.next_id, ...state.notes.map((n) => n.id + 1));
  for (const note of state.notes) if (note.id === 0) note.id = state.next_id++;
  return state;
}

function newNote(state, title) {
  return { id: state.next_id > 0 ? state.next_id++ : 0, title, text: "", hidden: false };
}

export function nextTitle(state) {
  for (let n = 1; ; n++) {
    const title = `Scratchpad ${n}`;
    if (!state.notes.some((note) => note.title === title)) return title;
  }
}

export function addNote(state) {
  state.notes.push(newNote(state, nextTitle(state)));
  state.active = state.notes.length - 1;
  return state.notes[state.active];
}

/** Removes note `i` and returns what `restoreNote` needs to undo it. */
export function removeNote(state, i) {
  const [note] = state.notes.splice(i, 1);
  const undo = { note, index: i, wasActive: state.active, placeholder: null };
  if (state.notes.length === 0) undo.placeholder = addNote(state).id;
  else if (state.active > i || state.active >= state.notes.length) state.active--;
  return undo;
}

export function restoreNote(state, { note, index, wasActive, placeholder }) {
  // The empty note that stood in for the last one goes again, if it is still untouched.
  const stand = state.notes.findIndex((n) => n.id === placeholder);
  if (stand >= 0 && state.notes[stand].text === "" && !isEncrypted(state.notes[stand])) state.notes.splice(stand, 1);
  state.notes.splice(Math.min(index, state.notes.length), 0, note);
  state.active = Math.min(wasActive, state.notes.length - 1);
}

/** Adds the notes of another notes.json (a backup or the desktop app's): new ids, nothing replaced. */
export function importNotes(state, raw) {
  const incoming = fromStored(raw).notes.filter((n) => n.text !== "" || isEncrypted(n));
  for (const note of incoming) {
    note.id = state.next_id++;
    state.notes.push(note);
  }
  return incoming.length;
}

/** The eye: Visible → Hidden → Revealed → Hidden. Never back to Visible: that is keepVisible. */
export function clickEye(note) {
  if (!note.hidden) note.hidden = true;
  else note.revealed = !note.revealed;
}

export function keepVisible(note) {
  note.hidden = false;
  note.revealed = false;
}

export const isMasked = (note) => note.hidden && !note.revealed;

/** The dropdown's label: the title and, in words, what the note is. */
export function label(note) {
  const marks = [];
  if (isEncrypted(note)) marks.push(isLocked(note) ? "locked" : "unlocked");
  if (note.hidden) marks.push("hidden");
  return marks.length ? `${note.title} (${marks.join(", ")})` : note.title;
}

/** What masked text looks like: a dot for every character, lines kept. */
export function mask(text) {
  return Array.from(text, (c) => (c === "\n" ? c : "•")).join("");
}

/** Stepping away (page hidden, or idle): hide revealed notes again; the caller locks encrypted ones. */
export function rehideAll(state) {
  for (const note of state.notes) note.revealed = false;
}
