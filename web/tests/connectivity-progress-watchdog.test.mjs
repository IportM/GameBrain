import assert from "node:assert/strict";
import { test } from "node:test";
import { createProgressWatchdog } from "../server/progressWatchdog.ts";

test("a progressing job can exceed the old five-minute wall limit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = [];
  const watchdog = createProgressWatchdog({ idleMs: 300_000, maximumMs: 1_800_000, onTimeout: (reason) => expired.push(reason) });
  for (let index = 0; index < 4; index++) {
    t.mock.timers.tick(240_000);
    watchdog.progress();
  }
  assert.deepEqual(expired, []);
  watchdog.stop();
});

test("five minutes without progress stops exactly once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = [];
  const watchdog = createProgressWatchdog({ idleMs: 300_000, maximumMs: 1_800_000, onTimeout: (reason) => expired.push(reason) });
  t.mock.timers.tick(300_000);
  watchdog.progress();
  t.mock.timers.tick(1_800_000);
  assert.deepEqual(expired, ["idle"]);
});

test("progress does not extend the absolute time limit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = [];
  const watchdog = createProgressWatchdog({ idleMs: 300_000, maximumMs: 900_000, onTimeout: (reason) => expired.push(reason) });
  for (let index = 0; index < 3; index++) { t.mock.timers.tick(240_000); watchdog.progress(); }
  t.mock.timers.tick(180_000);
  assert.deepEqual(expired, ["maximum"]);
});

test("completion or cancellation removes both timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = [];
  const watchdog = createProgressWatchdog({ idleMs: 300_000, maximumMs: 1_800_000, onTimeout: (reason) => expired.push(reason) });
  watchdog.stop(); watchdog.stop(); watchdog.progress();
  t.mock.timers.tick(2_000_000);
  assert.deepEqual(expired, []);
});
