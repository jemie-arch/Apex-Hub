import { cn } from '@/lib/cn';

/**
 * A small line, for the shape of a number over time rather than its value.
 *
 * No axes and no labels on purpose: this answers "which way is it going" and
 * nothing finer. Anything that needs reading off a scale belongs in a real
 * chart with a scale on it.
 *
 * A single point draws a flat line rather than nothing, because one day of data
 * is a fact worth showing and an empty box reads as broken.
 */
export function Sparkline({
  points,
  className,
  width = 120,
  height = 36,
  tone = 'accent',
}: {
  points: number[];
  className?: string;
  width?: number;
  height?: number;
  tone?: 'accent' | 'positive' | 'negative';
}) {
  const stroke =
    tone === 'positive'
      ? 'var(--positive)'
      : tone === 'negative'
        ? 'var(--negative)'
        : 'var(--accent)';

  if (points.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center', className)}
        style={{ width, height }}
      >
        <span className="text-[10px] text-fg-subtle">no data</span>
      </div>
    );
  }

  const series = points.length === 1 ? [points[0]!, points[0]!] : points;
  const max = Math.max(...series);
  const min = Math.min(...series);
  // A flat series would divide by zero and collapse to the top edge; centre it.
  const span = max - min || 1;
  const pad = 2;

  const coords = series.map((value, index) => {
    const x = pad + (index / (series.length - 1)) * (width - pad * 2);
    const y =
      max === min
        ? height / 2
        : pad + (1 - (value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${(width - pad).toFixed(1)},${height - pad}`;
  const last = coords[coords.length - 1]!;
  const id = `spark-${tone}-${series.length}-${Math.round(max)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The latest value is the one people look for, so it gets a dot. */}
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} />
    </svg>
  );
}
