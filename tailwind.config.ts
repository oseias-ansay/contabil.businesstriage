import type { Config } from "tailwindcss";

/**
 * As cores "primary" e "secondary" vêm de variáveis CSS injetadas por tenant
 * (ver src/app/layout.tsx). Assim, cada cliente white-label tem sua paleta
 * sem precisar recompilar o CSS.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          foreground: "rgb(var(--color-primary-fg) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--color-secondary) / <alpha-value>)",
          foreground: "rgb(var(--color-secondary-fg) / <alpha-value>)",
        },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
