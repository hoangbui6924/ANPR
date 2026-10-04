import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Search, Trash2, X } from "lucide-react";
import { api } from "@/api";
import type { Detection } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { BoxLegend, ImageWithBoxes } from "@/components/ImageWithBoxes";
import { PlateCard } from "@/components/PlateCard";
import { PlateText } from "@/components/PlateText";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Spinner, Table, Td, Th } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/utils";

const PAGE_SIZE = 10;

export function HistoryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState({ q: "", from: "", to: "" });
  const [selected, setSelected] = useState<Detection | null>(null);

  const query = useQuery({
    queryKey: ["detections", page, search],
    queryFn: () => api.detections({ page, pageSize: PAGE_SIZE, ...search }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteDetection(id),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["detections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch({ q, from, to });
  };
  const clear = () => {
    setQ("");
    setFrom("");
    setTo("");
    setPage(1);
    setSearch({ q: "", from: "", to: "" });
  };

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Lịch sử nhận dạng" description="Tìm theo biển số (gần đúng), lọc theo ngày, xem chi tiết từng lần nhận dạng." />

      <Card>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="q">
              Biển số
            </label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
              <Input id="q" className="pl-9" placeholder="VD: 51F15585 hoặc 51F-155" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="from">
              Từ ngày
            </label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="to">
              Đến ngày
            </label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit">Tìm</Button>
          {(search.q || search.from || search.to) && (
            <Button type="button" variant="ghost" onClick={clear}>
              <X className="size-4" /> Xóa lọc
            </Button>
          )}
        </form>

        {query.isError && (
          <div className="p-4">
            <ErrorBox error={query.error} />
          </div>
        )}
        {query.isLoading && (
          <div className="grid place-items-center py-16">
            <Spinner />
          </div>
        )}
        {data && data.items.length === 0 && <EmptyState title="Không có kết quả">Thử từ khóa khác hoặc bỏ bộ lọc ngày.</EmptyState>}
        {data && data.items.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Ảnh</Th>
                <Th>Biển số</Th>
                <Th>Thời gian</Th>
                <Th>Nguồn</Th>
                <Th>Người thực hiện</Th>
                <Th>Xử lý</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className="hover:bg-muted/50">
                  <Td>
                    <img src={d.imageUrl} alt="" className="h-12 w-18 rounded object-cover" />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      {d.plates.map((p, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <PlateText text={p.text} type={p.type} size="sm" list={p.list?.kind} />
                          {p.list?.kind === "black" && <Badge tone="danger">Đen</Badge>}
                          {!p.valid && <Badge tone="warning">Kiểm tra</Badge>}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">{fmt.dateTime(d.createdAt)}</Td>
                  <Td>
                    <Badge>{d.source === "webcam" ? "Webcam" : "Tải lên"}</Badge>
                  </Td>
                  <Td className="text-fg-muted">{d.createdBy ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-fg-muted">{fmt.ms(d.processMs)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(d)}>
                      <Eye className="size-4" /> Xem
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {data && data.total > 0 && (
          <div className="flex items-center justify-between gap-3 p-4 text-sm text-fg-muted">
            <span>
              {fmt.number(data.total)} lần nhận dạng · trang {page}/{pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" /> Trước
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Sau <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết lần nhận dạng #${selected.id}`}
            className="my-8 w-full max-w-4xl rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">Lần nhận dạng #{selected.id}</h2>
                <p className="text-sm text-fg-muted">
                  {fmt.dateTime(selected.createdAt)} · {fmt.ms(selected.processMs)}
                </p>
              </div>
              <div className="flex gap-2">
                {user?.role === "admin" && (
                  <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate(selected.id)}>
                    <Trash2 className="size-4" /> Xóa
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)} aria-label="Đóng">
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                <ImageWithBoxes src={selected.imageUrl} plates={selected.plates} />
                <BoxLegend />
              </div>
              <div className="space-y-3">
                {selected.plates.map((p, i) => (
                  <PlateCard key={i} plate={p} index={i} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
