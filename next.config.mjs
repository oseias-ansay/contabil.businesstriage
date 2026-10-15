/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // pdfmake usa fs/pdfkit: fica fora do bundle do servidor
  serverExternalPackages: ["pdfmake"],
};
export default nextConfig;
