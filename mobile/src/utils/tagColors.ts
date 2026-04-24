/**
 * Tag color utilities matching the desktop app's
 * rendering (hex → rgba with alpha).
 */

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function hexToRgba(
  hex: string, alpha: number,
): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export function tagBadgeStyle(
  hex: string,
): React.CSSProperties {
  const [r, g, b] = parseHex(hex)
  return {
    background: `rgba(${r},${g},${b},0.15)`,
    color: `rgb(${r},${g},${b})`,
    borderColor: `rgba(${r},${g},${b},0.35)`,
  }
}
