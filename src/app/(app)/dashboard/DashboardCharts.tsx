"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// Palette slots (validated categorical order — see the dataviz skill).
const BLUE = "#2a78d6"; // slot 1
const ORANGE = "#eb6834"; // slot 2
const GRID = "#e1e0d9";
const AXIS = "#c3c2b7";
const MUTED = "#898781";

export function AttendanceTrendChart({
  data,
}: {
  data: { date: string; attended: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: AXIS }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: "1px solid #e1e0d9", fontSize: 13 }}
        />
        <Line
          type="monotone"
          dataKey="attended"
          name="Checked in"
          stroke={BLUE}
          strokeWidth={2}
          dot={{ r: 3, fill: BLUE }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MoneyTrendChart({
  data,
  currency,
}: {
  data: { date: string; revenue: number; expense: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: MUTED, fontSize: 12 }}
          axisLine={{ stroke: AXIS }}
          tickLine={false}
        />
        <YAxis tick={{ fill: MUTED, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value) =>
            new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value ?? 0))
          }
          contentStyle={{ borderRadius: 8, border: "1px solid #e1e0d9", fontSize: 13 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Bar dataKey="revenue" name="Revenue" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expense" name="Expenses" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
