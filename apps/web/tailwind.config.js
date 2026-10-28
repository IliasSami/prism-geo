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
        // Prism: the brand accent (docs/brand). 600 is the primary: links, "you" bars, the logo wedge.
        accent: {
          50: "#F3F1FF",
          100: "#E8E4FF",
          200: "#D2CAFF",
          300: "#B1A3FF",
          400: "#8B74FC",
          500: "#6C4FF7",
          600: "#5A37EE",
          700: "#4A29D2",
          800: "#3D23A9",
          900: "#2F1D7F",
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
        "drawer-in": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "sheet-in": { from: { transform: "translateY(24px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "nav-progress": { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(250%)" } },
      },
      animation: {
        "fade-up": "fade-up 200ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        "fade-in": "fade-in 160ms ease-out both",
        "scale-in": "scale-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        shimmer: "shimmer 1.4s linear infinite",
        "bar-grow": "bar-grow 500ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        // "backwards" fill: nothing is left transformed afterwards, so no ancestor becomes the
        // containing block of a fixed overlay
        "drawer-in": "drawer-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        "sheet-in": "sheet-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        "nav-progress": "nav-progress 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
