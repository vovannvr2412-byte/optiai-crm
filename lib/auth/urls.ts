export function publicSiteUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return new URL(configured).origin;

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return new URL(request.url).origin;
}

export function passwordSetupUrl(request: Request) {
  return new URL("/set-password", publicSiteUrl(request)).toString();
}
