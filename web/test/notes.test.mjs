// The web app's notes model: what reaches storage, ids, the eye, import and undo.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as N from "../src/notes.js";

const unlocked = () => ({ id: 1, title: "Key", text: "secret plaintext", hidden: false, cipher: "CIPHER", password: "pw", sealed: "secret plaintext" });

test("an encrypted note is stored only as its cipher", () => {
  const state = N.defaultState();
  state.notes = [unlocked()];
  const json = JSON.stringify(N.toStored(state)) + JSON.stringify(N.toBackup(state));
  assert.ok(!json.includes("secret plaintext"));
  assert.ok(!json.includes('"pw"'));
  assert.deepEqual(N.toStored(state).notes[0], { id: 1, title: "Key", text: "", hidden: false, cipher: "CIPHER" });
});

test("a backup loads in the desktop app: no theme it does not know", () => {
  const state = N.defaultState();
  assert.equal(state.theme, "System");
  assert.ok(!("theme" in N.toBackup(state)));
});

test("loading: encrypted notes start locked, ids unique, active in range, junk ignored", () => {
  const state = N.fromStored({
    notes: [{ id: 3, title: "a", text: "x", cipher: "C" }, { id: 3, title: "b", text: "y" }, { title: "" }, null, 7],
    active: 9,
    next_id: 2,
    theme: "Neon",
  });
  assert.equal(state.notes.length, 3);
  assert.equal(state.notes[0].text, "");
  assert.ok(N.isLocked(state.notes[0]));
  assert.equal(state.notes[2].title, "Untitled");
  const ids = state.notes.map((n) => n.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => id > 0 && id < state.next_id));
  assert.equal(state.active, 2);
  assert.equal(state.theme, "System");
  assert.equal(N.fromStored(null).notes.length, 1);
});

test("the desktop app's notes.json imports, with new ids and nothing replaced", () => {
  const state = N.defaultState();
  state.notes[0].text = "mine";
  const desktop = { notes: [{ id: 1, title: "Scratchpad 1", text: "from desktop", hidden: true }, { id: 2, title: "Empty", text: "" }, { id: 5, title: "Vault", text: "", hidden: false, cipher: "C" }], pinned: true, theme: "Dark" };
  assert.equal(N.importNotes(state, desktop), 2);
  assert.deepEqual(state.notes.map((n) => n.text), ["mine", "from desktop", ""]);
  assert.equal(new Set(state.notes.map((n) => n.id)).size, 3);
  assert.ok(state.notes[1].hidden && N.isLocked(state.notes[2]));
});

test("the eye: visible, hidden, revealed, hidden; keep visible ends it", () => {
  const note = { hidden: false };
  N.clickEye(note);
  assert.ok(N.isMasked(note));
  N.clickEye(note);
  assert.ok(note.hidden && !N.isMasked(note));
  N.clickEye(note);
  assert.ok(N.isMasked(note));
  N.clickEye(note);
  N.keepVisible(note);
  assert.ok(!note.hidden && !N.isMasked(note));
  assert.equal(N.mask("ab\nc"), "••\n•");
});

test("new notes get the next free title and an id never used before", () => {
  const state = N.defaultState();
  const first = state.notes[0].id;
  N.removeNote(state, 0);
  assert.notEqual(state.notes[0].id, first);
  N.addNote(state);
  assert.deepEqual(state.notes.map((n) => n.title), ["Scratchpad 1", "Scratchpad 2"]);
  assert.equal(state.active, 1);
});

test("removing and restoring a note puts everything back", () => {
  const state = N.defaultState();
  N.addNote(state);
  N.addNote(state);
  state.active = 1;
  const before = structuredClone(state.notes);
  const undo = N.removeNote(state, 1);
  assert.equal(state.active, 1);
  assert.equal(state.notes[1].title, "Scratchpad 3");
  N.restoreNote(state, undo);
  assert.deepEqual(state.notes, before);
  assert.equal(state.active, 1);

  // The last note: an empty stand-in appears, and goes again on undo.
  const single = N.defaultState();
  single.notes[0].text = "keep";
  const u = N.removeNote(single, 0);
  assert.equal(single.notes.length, 1);
  N.restoreNote(single, u);
  assert.deepEqual(single.notes.map((n) => n.text), ["keep"]);
});

test("the dropdown says what a note is in words", () => {
  assert.equal(N.label({ title: "A", hidden: false }), "A");
  assert.equal(N.label({ title: "K", hidden: true, cipher: "C" }), "K (locked, hidden)");
  assert.equal(N.label(unlocked()), "Key (unlocked)");
});
