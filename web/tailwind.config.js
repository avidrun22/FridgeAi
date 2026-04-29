/** @type {import('tailwindcss').Config} */
// Theme tokens mirror App.js's `T` object so the iOS app and web app feel
// like the same product. If you change a color here, change it in App.js too
// (and ideally the website CSS variables on ok2eat.com).
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#F7FAF7",
        surface:  "#FFFFFF",
        card:     "#FFFFFF",
        accent:   "#16A34A",
        warn:     "#EA580C",
        danger:   "#DC2626",
        muted:    "#9CA3AF",
        text:     "#111827",
        textSoft: "#6B7280",
        border:   "#E5E7EB",
        // Brand cream — used for splash/icon, not the app interior
        cream:    "#F0EADC",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Menlo", "Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        md: "8px",
        lg: "12px",
        xl: "14px",
      },
    },
  },
  plugins: [],
};
