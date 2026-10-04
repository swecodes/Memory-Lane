import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules: keep them out of the bundle and load them with plain
  // require() at runtime. (Next already lists both by default; being explicit
  // documents the dependency and protects against that list changing.)
  serverExternalPackages: ["better-sqlite3", "sharp"],
};

export default nextConfig;
