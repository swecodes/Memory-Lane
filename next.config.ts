import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages with native binaries (or that load them) must not be bundled;
  // Next loads them with plain require() at runtime instead.
  serverExternalPackages: [
    "better-sqlite3",
    "sharp",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
};

export default nextConfig;
