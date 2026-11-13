import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { translate } = await import(compiledModule(new URL("../src/messages.ts", import.meta.url)));
const { LanguageProvider } = await import(compiledModule(new URL("../src/i18n.tsx", import.meta.url)));
const { ImageWorkflow, WorkflowStatus } = await import(compiledModule(new URL("../src/ImageWorkflow.tsx", import.meta.url)));

test("French remains unchanged and English labels are translated", () => {
  assert.equal(translate("Afficher la carte", "fr"), "Afficher la carte");
  assert.equal(translate("Afficher la carte", "en"), "Show map");
  assert.equal(translate("Coupe sagittale", "en"), "Sagittal slice");
});

test("dynamic messages prefer the most specific pattern", () => {
  assert.equal(translate("Expérience Allen 123 prête", "en"), "Allen experiment 123 ready");
  assert.equal(translate("Coupe 14 sur 527", "en"), "Slice 14 of 527");
  assert.equal(translate("3 régions sélectionnées", "en"), "3 selected regions");
});

test("paths, anatomical names and user content are preserved", () => {
  assert.equal(translate("Thalamus", "en"), "Thalamus");
  assert.equal(translate("Fichier manquant : C:\\Mouse $&\\image.nii.gz", "en"), "Missing file: C:\\Mouse $&\\image.nii.gz");
  assert.equal(translate("Unexpected diagnostic", "en"), "Unexpected diagnostic");
});

test("workflow and live progress render in English with original technical logs", () => {
  const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" },
    createElement(ImageWorkflow, { active: "atlas", hasImage: true, hasRegions: false, modalityCount: 0,
      nativeConnectivity: false, importStatus: "completed", atlasStatus: "running", modalityStatus: "idle",
      nativeStatus: "idle", busy: true, onNavigate() {} }),
    createElement(WorkflowStatus, { status: "running", title: "Recalage en cours", message: "Recalage complet de la souris vers Allen", logs: ["Journal original du calcul"] }),
  ));
  assert.match(html, /Registration running/);
  assert.match(html, /Registering the mouse image to Allen/);
  assert.match(html, /Technical log/);
  assert.match(html, /Journal original du calcul/);
  assert.doesNotMatch(html, /Recalage en cours/);
});
