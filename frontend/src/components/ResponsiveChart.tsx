"use client";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

type Size = { width: number; height: number };

export function ResponsiveChart({ className, children }: { className: string; children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      if (next.width > 0 && next.height > 0) {
        setSize((prev) => prev && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5 ? prev : next);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {size ? (
        <ResponsiveContainer initialDimension={size}>{children}</ResponsiveContainer>
      ) : (
        <div className="chart-placeholder" />
      )}
    </div>
  );
}
