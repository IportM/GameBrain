import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/ImageWorkflow.tsx", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from "([^"]+)"/g, (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { ImageWorkflow, WorkflowStatus } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const defaults = {
  active: "image", hasImage: false, hasRegions: false, modalityCount: 0,
  nativeConnectivity: false, importStatus: "idle", atlasStatus: "idle", modalityStatus: "idle",
  nativeStatus: "idle", busy: false, onNavigate() {},
};
const navigation = (props = {}) => renderToStaticMarkup(createElement(ImageWorkflow, { ...defaults, ...props }));

test("without an image only import is available", () => {
  const html = navigation();
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Image requise/);
});

test("modalities can be imported before Allen registration", () => {
  const html = navigation({ hasImage: true, active: "modalities" });
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
  assert.match(html, /Recalage requis/);
});

test("prepared image exposes all tasks and counts the modalities", () => {
  const html = navigation({ hasImage: true, hasRegions: true, modalityCount: 2, nativeConnectivity: true });
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /2 importées/);
});

test("an Allen experiment is not mistaken for an already projected native map", () => {
  const html = navigation({ hasImage: true, hasRegions: true, hasExperiment: true, active: "connectivity" });
  assert.match(html, /À projeter/);
});

test("a running operation locks navigation without hiding its current state", () => {
  const html = navigation({ hasImage: true, hasRegions: true, busy: true, active: "atlas", atlasStatus: "running" });
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.match(html, /En cours/);
});

test("failure is explicit even if a previous result is still available", () => {
  assert.match(navigation({ hasImage: true, hasRegions: true, atlasStatus: "failed" }), /Échec/);
});

test("technical logs stay collapsed and escaped", () => {
  const html = renderToStaticMarkup(createElement(WorkflowStatus, {
    status: "failed", title: "Recalage interrompu", message: "Erreur de préparation", logs: ["<script>unsafe</script>"],
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /<details class="workflow-logs">/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("busy progress does not invent a completion percentage", () => {
  const html = renderToStaticMarkup(createElement(WorkflowStatus, { status: "running", title: "Recalage en cours", message: "Préparation" }));
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /aria-valuenow/);
});

test("routine messages do not repeat the idle state", () => {
  const html = renderToStaticMarkup(createElement(WorkflowStatus, { status: "idle", title: "Choisir une image NIfTI", message: "Selectionnez une image" }));
  assert.match(html, /Choisir une image NIfTI/);
  assert.doesNotMatch(html, /Selectionnez une image/);
});

test("completed messages remain available inside the collapsed log", () => {
  const html = renderToStaticMarkup(createElement(WorkflowStatus, { status: "completed", title: "Image disponible", message: "Image prete dans le visualiseur", logs: ["OK"] }));
  assert.doesNotMatch(html, /workflow-status-message/);
  assert.match(html, /<details class="workflow-logs"><summary>Journal technique<\/summary><p>Image prete/);
});
