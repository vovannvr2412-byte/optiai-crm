export type UploadedMedia = {
  url: string;
  type: "image" | "video";
  name: string;
  mimeType: string;
};

type UploadTicket = {
  mode: "signed" | "local";
  mediaType: "image" | "video";
  fileName?: string;
  path?: string;
  token?: string;
  signedUrl?: string;
  publicUrl?: string;
  publicKey?: string;
  error?: string;
};

export async function uploadMediaFile(file: File): Promise<UploadedMedia> {
  const ticketResponse = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size })
  });
  const ticket = await ticketResponse.json() as UploadTicket;
  if (!ticketResponse.ok) throw new Error(ticket.error || "Не удалось подготовить загрузку файла.");

  if (ticket.mode === "signed") {
    if (!ticket.signedUrl || !ticket.publicUrl) throw new Error("Supabase не вернул адрес загрузки.");
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const headers: Record<string, string> = { "x-upsert": "false" };
    if (ticket.publicKey) {
      headers.apikey = ticket.publicKey;
      headers.Authorization = `Bearer ${ticket.publicKey}`;
    }
    const upload = await fetch(ticket.signedUrl, { method: "PUT", headers, body });
    if (!upload.ok) throw new Error("Файл не загрузился в Supabase Storage.");
    return { url: ticket.publicUrl, type: ticket.mediaType, name: file.name, mimeType: file.type };
  }

  if (!ticket.fileName) throw new Error("Сервер не подготовил локальное хранилище.");
  const body = new FormData();
  body.append("file", file);
  body.append("fileName", ticket.fileName);
  const upload = await fetch("/api/media", { method: "PUT", body });
  const result = await upload.json() as { url?: string; error?: string };
  if (!upload.ok || !result.url) throw new Error(result.error || "Не удалось загрузить файл.");
  return { url: result.url, type: ticket.mediaType, name: file.name, mimeType: file.type };
}
