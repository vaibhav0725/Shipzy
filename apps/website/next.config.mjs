// A static export: `next build` writes the whole site to out/, which `shipzy deploy` uploads.
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
