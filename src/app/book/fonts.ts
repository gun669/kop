// Font stacks for the guest-facing booking pages, loaded from @fontsource
// (self-hosted, bundled at build time) rather than next/font/google — no
// runtime fetch to fonts.googleapis.com, so a restrictive network at build
// or request time can't break the page. See ./layout.tsx for the actual
// @font-face imports.
export const displayFont = "'Fraunces', serif";
export const bodyFont = "'IBM Plex Sans', sans-serif";
