import { StringDecoder } from "node:string_decoder";
import type { TaskProgress } from "../src/taskProgress";

// Each process has its own decoder: a pipe chunk is not necessarily a full line.
export function createTaskProgress() {
  let decoder = new StringDecoder("utf8");
  let pending = "";
  let current: TaskProgress | null = null;
  return {
    get current() { return current; },
    reset() { current = null; pending = ""; decoder = new StringDecoder("utf8"); },
    push(chunk: Buffer) {
      pending += decoder.write(chunk);
      const lines = pending.split(/\r?\n/);
      pending = (lines.pop() ?? "").slice(-16384);
      let changed = false;
      for (const line of lines) {
        if (!line.startsWith("[PROGRESS] ")) continue;
        try {
          const value = JSON.parse(line.slice(11));
          if (typeof value.label !== "string" || value.label.length > 200) continue;
          current = { label: value.label };
          if (Number.isFinite(value.completed) && value.completed >= 0
            && Number.isFinite(value.total) && value.total > 0) {
            current.completed = Math.min(value.completed, value.total);
            current.total = value.total;
            current.unit = value.unit === "bytes" ? "bytes" : "slices";
          }
          changed = true;
        } catch { /* Ignore unrelated or incomplete diagnostic output. */ }
      }
      return changed;
    },
  };
}
