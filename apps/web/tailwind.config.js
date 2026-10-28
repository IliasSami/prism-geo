/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // Compact scale with a 12px floor: meta 12, body 14, lead 15, titles 18/22/28
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["15px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "26px" }],
        xl: ["22px", { lineHeight: "30px" }],
        "2xl": ["28px", { lineHeight: "36px" }],
        "3xl": ["34px", { lineHeight: "40px" }],
      },
      colors: {
        accent: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        pop: "0 12px 32px -8px rgba(16,24,40,0.18), 0 4px 8px -4px rgba(16,24,40,0.08)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "-400px 0" }, to: { backgroundPosition: "400px 0" } },
        "bar-grow": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
      },
      animation: {
        "fade-up": "fade-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-in": "fade-in 160ms ease-out both",
        "scale-in": "scale-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        shimmer: "shimmer 1.4s linear infinite",
        "bar-grow": "bar-grow 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};
