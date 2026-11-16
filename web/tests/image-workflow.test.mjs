import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { ImageWorkflow, WorkflowStatus } = await import(compiledModule(new URL("../src/ImageWorkflow.tsx", import.meta.url)));
const { uploadFile } = await import(compiledModule(new URL("../src/uploadFile.ts", import.meta.url)));
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

test("measurable progress has a real percentage and slice counter", () => {
  const html = renderToStaticMarkup(createElement(WorkflowStatus, {
    status: "running", title: "Import", message: "", progress: { label: "Préparation des coupes", completed: 25, total: 100, unit: "slices" },
  }));
  assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /width:25%/);
  assert.match(html, /25 \/ 100 coupes/);
  assert.match(html, /is-spinning/);
});

test("invalid totals stay indeterminate and failed jobs have no progress bar", () => {
  const progress = { label: "Upload", completed: 4, total: 0 };
  const html = renderToStaticMarkup(createElement(WorkflowStatus, { status: "running", title: "Import", message: "", progress }));
  assert.doesNotMatch(html, /aria-valuenow/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(WorkflowStatus, { status: "failed", title: "Import", message: "", progress })), /role="progressbar"/);
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

test("file uploads report bytes and preserve HTTP error responses", async () => {
  const original = globalThis.XMLHttpRequest;
  let request;
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};
    constructor() { request = this; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(file) { this.file = file; }
    getResponseHeader() { return "application/json"; }
  };
  try {
    const records = [];
    const file = { size: 100 };
    const pending = uploadFile("/api/import/start", file, { "X-File-Name": "test.nii" }, (progress) => records.push(progress));
    assert.equal(request.file, file);
    assert.equal(request.method, "POST");
    request.upload.onprogress({ loaded: 25, total: 100, lengthComputable: true });
    assert.equal(records.at(-1).completed, 25);
    request.upload.onload();
    assert.equal(records.at(-1), null);
    request.status = 422;
    request.responseText = '{"message":"Invalid image"}';
    request.onload();
    const response = await pending;
    assert.equal(response.ok, false);
    assert.deepEqual(await response.json(), { message: "Invalid image" });
    const failed = uploadFile("/api/import/start", file, {}, () => {});
    request.onerror();
    await assert.rejects(failed, /Transfert du fichier interrompu/);
  } finally { globalThis.XMLHttpRequest = original; }
});
