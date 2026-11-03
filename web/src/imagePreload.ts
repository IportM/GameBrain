const MAX_PRELOADED_IMAGES = 72;
const decodedImages = new Map<string, HTMLImageElement>();

export function preloadImages(urls: string[]) {
  for (const url of new Set(urls)) {
    const cached = decodedImages.get(url);
    if (cached) {
      decodedImages.delete(url);
      decodedImages.set(url, cached);
      continue;
    }

    const image = new Image();
    image.decoding = "async";
    image.src = url;
    decodedImages.set(url, image);
    void image.decode().catch(() => {
      decodedImages.delete(url);
    });
  }

  while (decodedImages.size > MAX_PRELOADED_IMAGES) {
    const oldestUrl = decodedImages.keys().next().value;
    if (oldestUrl === undefined) break;
    decodedImages.delete(oldestUrl);
  }
}
