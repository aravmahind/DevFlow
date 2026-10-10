/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Import only the icons/components a page uses, not whole libraries.
    optimizePackageImports: ['lucide-react', 'framer-motion', '@xyflow/react', 'date-fns', 'recharts'],
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
