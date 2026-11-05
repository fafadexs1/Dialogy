
function buildAllowedImagePatterns() {
  const configuredHosts = (process.env.NEXT_IMAGE_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.PRIVATE_S3_ENDPOINT]) {
    if (!value) continue;
    try {
      configuredHosts.push(new URL(value).hostname);
    } catch {
      // Invalid environment configuration is reported by the owning service at startup.
    }
  }
  return [...new Set(configuredHosts)].map((hostname) => ({ protocol: 'https', hostname }));
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  turbopack: {},
  trailingSlash: false,
  allowedDevOrigins: ['192.145.213.2'],
  serverExternalPackages: ['genkit', '@genkit-ai/core', 'handlebars'],
  experimental: {
    lockDistDir: false,
    serverActions: {
      bodySizeLimit: '10mb',
    },
    proxyClientMaxBodySize: '10mb',
  },
  transpilePackages: ['@supabase/node-fetch', '@radix-ui/react-slot', 'class-variance-authority'],
  typescript: { ignoreBuildErrors: false, tsconfigPath: process.env.NEXT_BUILD_TYPECHECK_CONFIG || 'tsconfig.json' },
  images: {
    remotePatterns: buildAllowedImagePatterns(),
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
