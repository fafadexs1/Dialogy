

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['genkit', '@genkit-ai/core', 'handlebars'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // Renamed from middlewareClientMaxBodySize
    proxyClientMaxBodySize: '100mb',
  },
  typescript: {
    // Evita que erros de tipo parem o build.
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  webpack: (config, { isServer, dev }) => {
    // Evita que modulos nativos sejam empacotados para o cliente.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
        fs: false,
      };
    }

    // Fix for OneDrive/Windows file locking issues and "Big strings" warning
    // Using memory cache avoids writing to the synced folder during dev
    if (dev) {
      config.cache = {
        type: 'memory',
      };
    }

    return config;
  },
  async headers() {
    return [
      {
        source: '/_next/server-actions/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/_next/data/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
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

console.log(
  'Next.js config loaded with experimental.serverActions.bodySizeLimit:',
  nextConfig.experimental?.serverActions?.bodySizeLimit
);

module.exports = nextConfig;
