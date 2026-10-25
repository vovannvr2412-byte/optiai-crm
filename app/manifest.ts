import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptiAI CRM",
    short_name: "OptiAI",
    description: "CRM для продаж и сопровождения клиентов OptiAI",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F7FA",
    theme_color: "#202939",
    icons: [{ src: "/icon.svg", sizes: "192x192", type: "image/svg+xml" }]
  };
}
