import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TecnoMES - Extrusion Intelligence",
    short_name: "TecnoMES",
    description: "Sistema MES para extrusão de alumínio com consulta operacional offline.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#ff6400",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
