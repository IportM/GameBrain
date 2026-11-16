import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskProgress } from "../server/taskProgress.ts";

test("progress records survive fragmented UTF-8 and multiple records per chunk", () => {
  const tracker = createTaskProgress();
  const data = Buffer.from('[PROGRESS] {"label":"Préparation","completed":5,"total":20}\n');
  const split = data.indexOf(0xc3) + 1;
  tracker.push(data.subarray(0, split));
  assert.equal(tracker.current, null);
  assert.equal(tracker.push(data.subarray(split)), true);
  assert.deepEqual(tracker.current, { label: "Préparation", completed: 5, total: 20, unit: "slices" });
  tracker.push(Buffer.from('[INFO] log\n[PROGRESS] {"label":"Recalage"}\n'));
  assert.deepEqual(tracker.current, { label: "Recalage" });
  tracker.reset();
  assert.equal(tracker.current, null);
});

test("malformed records are ignored; counts are bounded", () => {
  const tracker = createTaskProgress();
  tracker.push(Buffer.from('[PROGRESS] broken\n[PROGRESS] {"label":2}\n'));
  assert.equal(tracker.current, null);
  tracker.push(Buffer.from('[PROGRESS] {"label":"Upload","completed":120,"total":100,"unit":"bytes"}\n'));
  assert.equal(tracker.current.completed, 100);
  assert.equal(tracker.current.unit, "bytes");
});
