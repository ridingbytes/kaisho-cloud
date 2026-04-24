/**
 * Pixel avatar (identicon) matching the desktop app.
 *
 * Hashes the seed string to produce a 5x5 symmetric
 * grid with a hue derived from the hash.
 */

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

export function PixelAvatar({
  seed,
  size = 28,
  onClick,
}: {
  seed: string
  size?: number
  onClick?: () => void
}) {
  const hash = hashCode(seed)
  const grid = generateGrid(hash)
  const hue = hash % 360
  const fill = `hsl(${hue}, 60%, 55%)`
  const cellSize = size / 5

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
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
    </svg>
  )
}
