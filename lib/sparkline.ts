export function toSparklinePath(values: number[], width = 100, height = 40): string {
  if (values.length === 0) return `M0,${height} L${width},${height}`;
  if (values.length === 1) return `M0,${height / 2} L${width},${height / 2}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return [x, y];
  });

  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}
