import { useQuery } from "@tanstack/react-query";
import { Bike, Car, CheckCircle2, ScanLine, ShieldAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import { api } from "@/api";
import { PageHeader } from "@/components/AppLayout";
import { Card, CardHeader, ErrorBox, Spinner } from "@/components/ui";
import { fmt } from "@/lib/utils";

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </Card>
  );
}

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--fg)",
  fontSize: 13,
};

export function StatsPage() {
  const summary = useQuery({ queryKey: ["stats", "summary"], queryFn: api.statsSummary });
  const daily = useQuery({ queryKey: ["stats", "daily"], queryFn: () => api.statsDaily(14) });

  if (summary.isError) return <ErrorBox error={summary.error} />;
  if (!summary.data)
    return (
      <div className="grid place-items-center py-24">
        <Spinner />
      </div>
    );

  const s = summary.data;
  const vehicles = [
    { name: "Xe máy", value: s.motorbike, color: "var(--box-2line)" },
    { name: "Ô tô", value: s.car, color: "var(--box-1line)" },
  ];

  return (
    <>
      <PageHeader title="Thống kê" description="Số lượt nhận dạng, tỷ lệ loại xe và tỷ lệ biển đọc hợp lệ." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<ScanLine className="size-4" />} label="Lượt nhận dạng" value={fmt.number(s.totalDetections)} hint={`${s.today} lượt hôm nay`} />
        <Stat icon={<Car className="size-4" />} label="Biển số đọc được" value={fmt.number(s.totalPlates)} />
        <Stat icon={<CheckCircle2 className="size-4" />} label="Tỷ lệ hợp lệ" value={fmt.percent(s.validRate, 1)} hint="Khớp định dạng biển Việt Nam" />
        <Stat icon={<ShieldAlert className="size-4" />} label="Cảnh báo danh sách đen" value={fmt.number(s.blacklistHits)} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Lượt nhận dạng 14 ngày gần nhất" />
          <div className="h-72 p-4">
            {daily.data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily.data} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={fmt.dayMonth} tick={{ fill: "var(--fg-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--fg-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--muted)" }}
                    labelFormatter={(d) => fmt.dayMonth(String(d))}
                    formatter={(v) => [v, "Lượt"]}
                  />
                  <Bar dataKey="detections" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center">
                <Spinner />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Tỷ lệ loại xe" />
          <div className="h-56 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={vehicles} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--surface)">
                  {vehicles.map((v) => (
                    <Cell key={v.name} fill={v.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 px-4 pb-5 text-sm">
            <span className="flex items-center gap-2">
              <Bike className="size-4" style={{ color: "var(--box-2line)" }} /> Xe máy: <b>{s.motorbike}</b>
            </span>
            <span className="flex items-center gap-2">
              <Car className="size-4" style={{ color: "var(--box-1line)" }} /> Ô tô: <b>{s.car}</b>
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
