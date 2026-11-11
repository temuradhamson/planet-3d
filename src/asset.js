/** Public files work under /planet/, GitHub Pages, or a local root. */
export function assetUrl(path) {
  return `${import.meta.env.BASE_URL}${String(path).replace(/^\//, "")}`;
}
