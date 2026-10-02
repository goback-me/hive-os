import { getRevenueByMonth, revenueInMonth } from "./revenue";

// Main dashboard revenue trend (page.tsx uses this one). Same source as the
// client pages/awards (lib/revenue.ts), so the agency chart always equals the
// sum of what each client's own page shows.
export async function getRevenueTrend(months = 12) {
  const now = new Date();
  const revenue = await getRevenueByMonth();
  const points: { label: string; revenue: number }[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    points.push({
      label: start.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: revenueInMonth(revenue, start),
    });
  }

  return points;
}
