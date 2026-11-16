export function createProgressWatchdog({ idleMs, maximumMs, onTimeout }: {
  idleMs: number;
  maximumMs: number;
  onTimeout: (reason: "idle" | "maximum") => void;
}) {
  let stopped = false;
  let idleTimer: ReturnType<typeof setTimeout>;
  const stop = () => {
    stopped = true;
    clearTimeout(idleTimer);
    clearTimeout(maximumTimer);
  };
  const expire = (reason: "idle" | "maximum") => {
    if (stopped) return;
    stop();
    onTimeout(reason);
  };
  const maximumTimer = setTimeout(() => expire("maximum"), maximumMs);
  const progress = () => {
    if (stopped) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire("idle"), idleMs);
  };
  progress();
  return { progress, stop };
}
