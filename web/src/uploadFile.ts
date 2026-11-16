import type { TaskProgress } from "./taskProgress";

export function uploadFile(url: string, file: File, headers: Record<string, string>,
  onProgress: (progress: TaskProgress | null) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    onProgress({ label: "Transfert du fichier", completed: 0, total: file.size, unit: "bytes" });
    request.upload.onprogress = (event) => onProgress({ label: "Transfert du fichier",
      completed: event.loaded, total: event.lengthComputable ? event.total : file.size, unit: "bytes" });
    request.upload.onload = () => onProgress(null);
    request.onerror = () => { onProgress(null); reject(new Error("Transfert du fichier interrompu")); };
    request.onabort = request.onerror;
    request.onload = () => {
      onProgress(null);
      resolve(new Response(request.responseText, { status: request.status,
        headers: { "Content-Type": request.getResponseHeader("Content-Type") ?? "application/json" } }));
    };
    request.send(file);
  });
}
