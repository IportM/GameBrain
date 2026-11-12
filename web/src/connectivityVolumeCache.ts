import { Data3DTexture, LinearFilter, RedFormat, UnsignedByteType } from "three";

const MAX_VOLUMES = 6;
const MAX_BYTES = 32 * 1024 * 1024;

type CachedVolume = {
  url: string;
  users: number;
  bytes: number;
  retired: boolean;
  disposed: boolean;
  controller: AbortController;
  texture?: Data3DTexture;
  promise: Promise<Data3DTexture>;
};

const volumes = new Map<string, CachedVolume>();

function disposeUnused(entry: CachedVolume) {
  if (entry.users !== 0) return;
  entry.controller.abort();
  if (entry.texture && !entry.disposed) {
    entry.disposed = true;
    entry.texture.dispose();
  }
}

function trim() {
  let bytes = [...volumes.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of volumes) {
    if (volumes.size <= MAX_VOLUMES && bytes <= MAX_BYTES) break;
    if (entry.users !== 0) continue;
    volumes.delete(key);
    bytes -= entry.bytes;
    entry.retired = true;
    disposeUnused(entry);
  }
}

async function loadTexture(url: string, shape: [number, number, number], signal: AbortSignal) {
  const count = shape.reduce((a, b) => a * b, 1);
  if (!shape.every((size) => Number.isSafeInteger(size) && size > 0) || !Number.isSafeInteger(count)) {
    throw new Error("Dimensions du volume de connectivité incompatibles");
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Volume de connectivité indisponible");
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException("Chargement annulé", "AbortError");
  if (buffer.byteLength !== count) throw new Error("Dimensions du volume de connectivité incompatibles");
  const texture = new Data3DTexture(new Uint8Array(buffer), ...shape);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export function retainConnectivityTexture(url: string, shape: [number, number, number]) {
  const key = `${url}|${shape.join("x")}`;
  let entry = volumes.get(key);
  if (entry) {
    entry.users += 1;
    volumes.delete(key);
    volumes.set(key, entry);
  } else {
    const controller = new AbortController();
    const created: CachedVolume = {
      url, users: 1, bytes: 0, retired: false, disposed: false, controller,
      promise: loadTexture(url, shape, controller.signal).then((texture) => {
        created.texture = texture;
        created.bytes = texture.image.data.byteLength;
        if (created.retired) disposeUnused(created);
        trim();
        return texture;
      }).catch((error) => {
        if (volumes.get(key) === created) volumes.delete(key);
        created.retired = true;
        disposeUnused(created);
        throw error;
      }),
    };
    entry = created;
    volumes.set(key, entry);
  }
  const retained = entry;
  let released = false;
  trim();
  return {
    promise: retained.promise,
    release() {
      if (released) return;
      released = true;
      retained.users -= 1;
      if (retained.retired) disposeUnused(retained);
      else if (!retained.texture && retained.users === 0) {
        if (volumes.get(key) === retained) volumes.delete(key);
        retained.retired = true;
        disposeUnused(retained);
      }
      trim();
    },
  };
}

export function clearConnectivityVolumeCache(urlPrefix = "") {
  for (const [key, entry] of volumes) {
    if (!entry.url.startsWith(urlPrefix)) continue;
    volumes.delete(key);
    entry.retired = true;
    disposeUnused(entry);
  }
}
