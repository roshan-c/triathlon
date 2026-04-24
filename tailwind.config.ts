import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        shell: "#111512",
        mist: "#ecefea",
        panel: "#f9fbf8",
        accent: "#ff4eb8",
        danger: "#d83c48",
        warn: "#c98922",
        ok: "#2c9a55"
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-monospace", "monospace"],
        body: ["var(--font-body)", "ui-monospace", "monospace"]
      },
      boxShadow: {
        soft: "4px 4px 0 rgba(17, 21, 18, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
