import path from "node:path";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { contentTypeForModulePath } from "@/lib/content-module/package";
import { CONTENT_MODULE_BUCKET } from "@/lib/content-module/store";

type RuntimeRow = { storage_prefix: string; object_paths: string[] };

function safeRuntimePath(segments: string[]) {
  const value = segments.join("/");
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}

function prepareHtml(html: string, token: string, filePath: string) {
  const directory = path.posix.dirname(filePath);
  const encodedDirectory = directory === "." ? "" : `${directory.split("/").map(encodeURIComponent).join("/")}/`;
  const runtimeBase = `/content-runtime/${encodeURIComponent(token)}/${encodedDirectory}`;
  const baseTag = `<base href="${runtimeBase}">`;
  const withBase = /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${baseTag}`)
    : `${baseTag}${html}`;
  return withBase.replace(/(\s(?:src|href|poster)=(["']))\/(?!\/)/gi, `$1${runtimeBase}`);
}

export async function GET(_request: Request, context: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path: pathSegments } = await context.params;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) return new Response("Not found", { status: 404 });
  const filePath = safeRuntimePath(pathSegments);
  if (!filePath) return new Response("Not found", { status: 404 });

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("content_module_installations")
    .select("storage_prefix,object_paths")
    .eq("access_token", token)
    .maybeSingle();
  if (error || !data) return new Response("Not found", { status: 404 });
  const installation = data as RuntimeRow;
  if (!(installation.object_paths ?? []).includes(filePath)) return new Response("Not found", { status: 404 });
  const objectPath = `${installation.storage_prefix}/${filePath}`;

  if (filePath.toLowerCase().endsWith(".html")) {
    const { data: file, error: downloadError } = await supabase.storage.from(CONTENT_MODULE_BUCKET).download(objectPath);
    if (downloadError || !file) return new Response("Not found", { status: 404 });
    const html = prepareHtml(await file.text(), token, filePath);
    return new Response(html, {
      headers: {
        "Content-Type": contentTypeForModulePath(filePath),
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; style-src 'self' 'unsafe-inline' data: https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src https: wss:; frame-ancestors 'self'; form-action 'none'; object-src 'none'; worker-src 'self' blob:;",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  const { data: signed, error: signedError } = await supabase.storage.from(CONTENT_MODULE_BUCKET).createSignedUrl(objectPath, 300);
  if (signedError || !signed?.signedUrl) return new Response("Not found", { status: 404 });
  return Response.redirect(signed.signedUrl, 307);
}
