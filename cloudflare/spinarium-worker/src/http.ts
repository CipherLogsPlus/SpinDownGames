export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
export { HttpError as ApiError };

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  const safeHeaders = new Headers(headers);
  safeHeaders.set("Content-Type", "application/json; charset=utf-8");
  safeHeaders.set("Cache-Control", "no-store");
  safeHeaders.set("X-Content-Type-Options", "nosniff");
  safeHeaders.set("Referrer-Policy", "no-referrer");
  safeHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(JSON.stringify(value), { status, headers: safeHeaders });
}

export async function readBytes(request: Request, maximum: number): Promise<Uint8Array> {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request, maximum = 16384): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new HttpError(415, "JSON_REQUIRED", "Send JSON for this request.");
  const bytes = await readBytes(request, maximum);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new HttpError(400, "INVALID_JSON", "Send valid JSON for this request."); }
}
