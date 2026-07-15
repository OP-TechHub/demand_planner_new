/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@oceanpick/shared', '@oceanpick/engine'],
};
export default nextConfig;
