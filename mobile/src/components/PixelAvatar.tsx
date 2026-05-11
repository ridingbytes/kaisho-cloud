/**
 * Multi-style avatar renderer.
 *
 * Mirrors the desktop component so the same ``(seed, style)``
 * pair shown in the desktop app renders identically on the
 * mobile PWA. All styles are client-side, no remote API
 * calls -- DiceBear is bundled via npm packages and the seed
 * never leaves the device.
 *
 * The default ``invaders`` style is the legacy 5x5 symmetric
 * pixel sprite that shipped before the multi-style picker.
 */
import { useEffect, useState } from "react"

export type AvatarStyle =
  | "invaders"
  | "pixel-art"
  | "bottts"
  | "adventurer"

export const AVATAR_STYLES: AvatarStyle[] = [
  "invaders",
  "pixel-art",
  "bottts",
  "adventurer",
]

export const DEFAULT_AVATAR_STYLE: AvatarStyle = "invaders"

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function generateGrid(hash: number): boolean[] {
  const grid: boolean[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bit = (hash >> (row * 3 + col)) & 1
      grid[row * 5 + col] = bit === 1
      grid[row * 5 + (4 - col)] = bit === 1
    }
    const centerBit = (hash >> (15 + row)) & 1
    grid[row * 5 + 2] = centerBit === 1
  }
  return grid
}

function renderInvaders(seed: string, size: number) {
  const hash = hashCode(seed)
  const grid = generateGrid(hash)
  const hue = hash % 360
  const fill = `hsl(${hue}, 60%, 55%)`
  const cellSize = size / 5
  return (
    <>
      <rect
        width={size}
        height={size}
        rx={size * 0.15}
        fill="var(--raised, #f3f4f6)"
      />
      {grid.map((on, i) => {
        if (!on) return null
        const row = Math.floor(i / 5)
        const col = i % 5
        return (
          <rect
            key={i}
            x={col * cellSize}
            y={row * cellSize}
            width={cellSize}
            height={cellSize}
            fill={fill}
          />
        )
      })}
    </>
  )
}

const DICEBEAR_LOADERS: Record<
  string,
  () => Promise<unknown>
> = {
  "pixel-art": () => import("@dicebear/pixel-art"),
  bottts: () => import("@dicebear/bottts"),
  adventurer: () => import("@dicebear/adventurer"),
}

async function renderDicebearDataUri(
  style: string, seed: string,
): Promise<string> {
  const [{ createAvatar }, mod] = await Promise.all([
    import("@dicebear/core"),
    DICEBEAR_LOADERS[style](),
  ])
  const svg = createAvatar(
    mod as Parameters<typeof createAvatar>[0],
    { seed },
  ).toString()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function resolveStyle(value?: string): AvatarStyle {
  if (
    value
    && (AVATAR_STYLES as string[]).includes(value)
  ) {
    return value as AvatarStyle
  }
  return DEFAULT_AVATAR_STYLE
}

export function PixelAvatar({
  seed,
  size = 28,
  style,
  onClick,
}: {
  seed: string
  size?: number
  style?: string
  onClick?: () => void
}) {
  const resolved = resolveStyle(style)
  const [dataUri, setDataUri] = useState<string | null>(null)

  useEffect(() => {
    if (resolved === "invaders") {
      setDataUri(null)
      return
    }
    let cancelled = false
    renderDicebearDataUri(resolved, seed).then((uri) => {
      if (!cancelled) setDataUri(uri)
    })
    return () => {
      cancelled = true
    }
  }, [resolved, seed])

  const cursor = onClick ? { cursor: "pointer" } : undefined

  if (resolved !== "invaders" && dataUri) {
    return (
      <img
        src={dataUri}
        width={size}
        height={size}
        onClick={onClick}
        style={cursor}
        alt="Avatar"
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onClick={onClick}
      style={cursor}
      role="img"
      aria-label="Avatar"
    >
      {renderInvaders(seed, size)}
    </svg>
  )
}
