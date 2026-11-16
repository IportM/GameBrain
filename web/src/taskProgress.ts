export type TaskProgress = {
  label: string;
  completed?: number;
  total?: number;
  unit?: "bytes" | "slices";
};

export function progressPercent(progress?: TaskProgress | null): number | null {
  if (!progress || !Number.isFinite(progress.completed) || !Number.isFinite(progress.total)
    || progress.total! <= 0 || progress.completed! < 0) return null;
  return Math.min(100, Math.floor(progress.completed! / progress.total! * 100));
}
