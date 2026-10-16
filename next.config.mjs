/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // pdfmake usa fs/pdfkit e o pdfjs carrega o próprio worker: ficam fora do bundle do servidor
  serverExternalPackages: ["pdfmake", "pdfjs-dist"],
};
export default nextConfig;
