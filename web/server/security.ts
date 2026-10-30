import type { IncomingMessage } from "node:http";

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLocaleLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function isLocalApiRequest(request: IncomingMessage) {
  const remoteAddress = request.socket.remoteAddress ?? "";
  const localSocket = remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress.startsWith("::ffff:127.");
  if (!localSocket || !request.headers.host) return false;

  try {
    if (!isLoopbackHost(new URL(`http://${request.headers.host}`).hostname)) return false;
    const origin = request.headers.origin;
    return !origin || isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}
