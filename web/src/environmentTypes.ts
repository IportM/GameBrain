export type EnvironmentCheck = { module: string; package: string; status: "available" | "missing" | "broken"; error?: string };
export type PythonProbe = {
  python: string;
  version: string;
  compatible: boolean;
  compatibilityError?: string | null;
  profile?: "mac-intel" | "default";
  verified: boolean;
  checks: EnvironmentCheck[];
  resourcesMissing: string[];
};
export type EnvironmentReport = {
  status: "checking" | "ready" | "blocked";
  selected: PythonProbe | null;
  candidates: Array<{ python: string; version?: string; compatible?: boolean; missing?: number; error?: string }>;
  explicit: boolean;
  error?: string;
};
