import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["chromadb", "@chroma-core/default-embed", "onnxruntime-node"],
  webpack: (config, { webpack }) => {
    // chromadb does a dynamic import("@chroma-core/default-embed") which pulls in
    // onnxruntime-node (a native addon). Webpack can't bundle native addons, so the
    // build fails on Vercel. Since we use ChromaDB Cloud, embeddings are handled
    // server-side — the client-side embedding function is never needed at runtime.
    // chromadb's own try-catch handles the missing module gracefully.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@chroma-core\/default-embed$/,
      }),
      new webpack.IgnorePlugin({
        resourceRegExp: /^onnxruntime-node$/,
      }),
    );
    return config;
  },
};

export default nextConfig;
