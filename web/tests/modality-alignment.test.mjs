import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { default: ModalityAlignment, SessionImport, modalityAlignmentConfirmed } = await import(compiledModule(new URL("../src/ModalityAlignment.tsx", import.meta.url)));
const render = (session, aligned = false) => renderToStaticMarkup(createElement(ModalityAlignment, {
  session, aligned, disabled: false, onSessionChange() {}, onAlignedChange() {},
}));

test("import requires a same-session declaration AND explicit anatomical alignment confirmation", () => {
  for (const session of ["", "other", "unknown"]) {
    assert.equal(modalityAlignmentConfirmed(session, false), false);
    assert.equal(modalityAlignmentConfirmed(session, true), false);
  }
  assert.equal(modalityAlignmentConfirmed("same", false), false);
  assert.equal(modalityAlignmentConfirmed("same", true), true);
  assert.equal(modalityAlignmentConfirmed("other", true, true), true);
  assert.equal(modalityAlignmentConfirmed("other", false, true), false);
  assert.equal(modalityAlignmentConfirmed("unknown", true, true), false);
});

test("same-session notice distinguishes anatomy from grid resampling", () => {
  const html = render("same");
  assert.match(html, /type="checkbox"/);
  assert.match(html, /grille identique ne garantit pas/);
  assert.match(html, /rééchantillonnage ne corrige pas/);
});

test("other session requires selecting a registered RARE; uncertain session stays blocked", () => {
  assert.match(render("other"), /Choisir une session recalée/);
  assert.doesNotMatch(render("other"), /type="checkbox"/);
  assert.match(render("unknown"), /Identifiez d/);
  assert.doesNotMatch(render("unknown"), /type="checkbox"/);
});

test("a registered session exposes its RARE and modality alignment confirmation", () => {
  const html = renderToStaticMarkup(createElement(ModalityAlignment, {
    session: "other", aligned: false, disabled: false,
    selectedSessionId: "ses2", sessions: [{ id: "ses2", name: "Session 2", sourceFile: "ses2_RARE.nii.gz", previewModalityId: "preview" }],
    onSessionChange() {}, onAlignedChange() {}, onAddSession() {},
  }));
  assert.match(html, /ses2_RARE.nii.gz/);
  assert.match(html, /Vérifier la RARE/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /Ajouter une session \(RARE\)/);
  assert.doesNotMatch(html, /type="file"/);
});

test("the dedicated session form exposes one RARE picker without a collapsed menu", () => {
  const html = renderToStaticMarkup(createElement(SessionImport, { disabled: false, onRegister: async () => true }));
  assert.match(html, /RARE de la nouvelle session/);
  assert.match(html, /Recaler cette RARE/);
  assert.match(html, /référence reste conservée/);
  assert.equal((html.match(/type="file"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<details|Nom de la modalité/);
});
