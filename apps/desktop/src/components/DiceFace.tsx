import type { CSSProperties } from "react";

interface DiceFaceProps {
  sides: number;
  value?: number;
  compact?: boolean;
  colors?: { body: string; number: string };
}

export function DiceFace({ sides, value, compact = false, colors }: DiceFaceProps) {
  const style = colors ? ({ "--die-color": colors.body, "--die-number": colors.number } as CSSProperties) : undefined;
  return (
    <span className={`dice-face dice-face-d${sides} ${compact ? "compact" : ""}`} aria-hidden="true" style={style}>
      <i />
      <b>{value ?? (sides === 100 ? "%" : sides)}</b>
    </span>
  );
}
