/**
 * PTB's brand colors, from the logo (`docs/logo.md` in planthingsbetter-web).
 *
 * For anything that can't read the app's CSS variables: emails, share images,
 * the Obsidian plugin, mockups, merch. Inside the app, use the person's accent
 * (`--primary`) instead - it follows the color they picked, and violet is only
 * its default. For colors that mean something (done, in progress, failed), use
 * `STATUS_COLORS`.
 *
 *   violet      - the brand violet, on light backgrounds
 *   lightViolet - the same on dark backgrounds and on the icon's tile
 *   tile        - the icon's background (the violet's hue at OKLCH lightness 25)
 *   ink         - the letters on light backgrounds
 *   white       - the letters on the tile
 *
 * Never put anything on `violet` itself: the light violet dot and bar vanish
 * against it.
 */
export const BRAND_COLORS = {
  violet: "#7a48db",
  lightViolet: "#b498ff",
  tile: "#251645",
  ink: "#0b0b0d",
  white: "#ffffff",
} as const;

export type BrandColorName = keyof typeof BRAND_COLORS;
