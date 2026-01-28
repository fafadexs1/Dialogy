

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

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  // Disable in development if you want to debug, but enables PWA features (like manifest) even in dev often. 
  // keeping it enabled for dev to verify PWA works (manifest is static anyway).
  // But usually disabled to avoid caching issues during dev.
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  workboxOptions: {
    disableDevLogs: true,
  },
});

module.exports = withPWA(nextConfig);
