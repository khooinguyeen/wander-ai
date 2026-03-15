import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@chroma-core\/default-embed$/,
      })
    );
    return config;
  },
};

export default nextConfig;
