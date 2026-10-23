import { contentTypeForLocalMedia, readLocalMedia } from "@/lib/media/storage";

export async function GET(_request: Request, context: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await context.params;
  const media = readLocalMedia(fileName);
  if (!media) return new Response("Not found", { status: 404 });
  return new Response(media, {
    headers: {
      "Content-Type": contentTypeForLocalMedia(fileName),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
