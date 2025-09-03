
import dotenv from 'dotenv';
dotenv.config();

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  typescript: {
    // Evita que erros de tipo parem o build. Útil em desenvolvimento, mas use com cautela em produção.
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
      }
    ],
     domains: ['localhost'],
  },
  webpack: (config, { isServer }) => {
    // Esta configuração é crucial. Ela instrui o Webpack a não tentar empacotar
    // módulos nativos do Node.js (como 'fs' ou 'async_hooks') no bundle do cliente,
    // onde eles não funcionariam e causariam erros.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        async_hooks: false,
        fs: false,
        // Adicione outros módulos nativos do Node.js aqui se encontrar mais erros.
      };
    }
    return config;
  },
};

export default nextConfig;
