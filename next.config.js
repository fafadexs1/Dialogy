require('dotenv').config();

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['genkit', '@genkit-ai/core', 'handlebars'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    middlewareClientMaxBodySize: '100mb',
  },
  typescript: {
    // Evita que erros de tipo parem o build.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Permite que o build continue mesmo com avisos do ESLint.
    ignoreDuringBuilds: true,
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
    domains: ['localhost'],
  },
  webpack: (config, { isServer }) => {
    // Evita que modulos nativos sejam empacotados para o cliente.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
        fs: false,
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
