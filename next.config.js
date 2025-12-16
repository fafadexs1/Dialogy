

const enableWebpackOverrides = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['genkit', '@genkit-ai/core', 'handlebars'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // Renamed from middlewareClientMaxBodySize
    // Renamed from middlewareClientMaxBodySize
    proxyClientMaxBodySize: '100mb',
  },
  transpilePackages: ['@supabase/node-fetch', '@radix-ui/react-slot', 'class-variance-authority'],
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
  /*
    ...(enableWebpackOverrides && {
      webpack: (config, { isServer, dev }) => {
        // Evita que modulos nativos sejam empacotados para o cliente.
        if (!isServer) {
          config.resolve.fallback = {
            ...config.resolve.fallback,
            async_hooks: false,
            fs: false,
          };
        }
  
        // Disable disk cache for all environments to avoid OneDrive/FS issues
        config.cache = {
          type: 'memory',
        };
  
        return config;
      },
    }),
  */
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

if (!enableWebpackOverrides) {
  console.log('Skipping custom webpack config (dev uses Turbopack).');
}

module.exports = nextConfig;
