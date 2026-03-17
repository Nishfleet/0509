import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "weekly",
      lastModified: new Date(),
      priority: 1,
      url: "https://0509.in",
    },
    {
      changeFrequency: "weekly",
      lastModified: new Date(),
      priority: 0.9,
      url: "https://0509.in/search",
    },
  ];
}
