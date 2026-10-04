import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/api";
import type { ListKind } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { PlateText } from "@/components/PlateText";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Input, Label, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { cn, fmt } from "@/lib/utils";

const TABS: { kind: ListKind | undefined; label: string }[] = [
  { kind: undefined, label: "Tất cả" },
  { kind: "black", label: "Danh sách đen" },
  { kind: "white", label: "Danh sách trắng" },
];

export function ListsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ListKind | undefined>(undefined);
  const [plate, setPlate] = useState("");
  const [kind, setKind] = useState<ListKind>("black");
  const [note, setNote] = useState("");

  const lists = useQuery({ queryKey: ["lists", tab], queryFn: () => api.lists(tab) });

  const add = useMutation({
    mutationFn: () => api.addListEntry({ plateText: plate, kind, note }),
    onSuccess: () => {
      setPlate("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteListEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });

  const norm = normalizePlate(plate);
  const preview = norm ? formatPlate(norm) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (norm) add.mutate();
  };

  return (
    <>
      <PageHeader title="Danh sách xe" description="Biển số trong danh sách đen sẽ được cảnh báo ngay khi nhận dạng." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Thêm biển số" />
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <Label htmlFor="plate">Biển số</Label>
              <Input id="plate" placeholder="VD: 51F-155.85" value={plate} onChange={(e) => setPlate(e.target.value)} required />
              {preview && (
                <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                  <PlateText text={preview.text} size="sm" />
                  {preview.valid ? <Badge tone="success">Đúng định dạng</Badge> : <Badge tone="warning">Sai định dạng</Badge>}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="kind">Loại danh sách</Label>
              <Select id="kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as ListKind)}>
                <option value="black">Danh sách đen (cảnh báo)</option>
                <option value="white">Danh sách trắng (cho phép)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="note">Ghi chú</Label>
              <Input id="note" placeholder="VD: Xe báo mất cắp" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {add.isError && <ErrorBox error={add.error} />}
            <Button type="submit" className="w-full" loading={add.isPending} disabled={!norm}>
              <Plus className="size-4" /> Thêm vào danh sách
            </Button>
          </form>
        </Card>

        <Card>
          <div className="flex gap-1 border-b border-border p-2">
            {TABS.map((t) => (
              <button
                key={t.label}
                onClick={() => setTab(t.kind)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === t.kind ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {lists.isError && (
            <div className="p-4">
              <ErrorBox error={lists.error} />
            </div>
          )}
          {lists.isLoading && (
            <div className="grid place-items-center py-16">
              <Spinner />
            </div>
          )}
          {lists.data?.length === 0 && <EmptyState title="Danh sách trống">Thêm biển số ở khung bên trái.</EmptyState>}
          {!!lists.data?.length && (
            <Table>
              <thead>
                <tr>
                  <Th>Biển số</Th>
                  <Th>Loại</Th>
                  <Th>Ghi chú</Th>
                  <Th>Ngày thêm</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lists.data.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/50">
                    <Td>
                      <PlateText text={e.plateText} size="sm" list={e.kind} />
                    </Td>
                    <Td>
                      {e.kind === "black" ? (
                        <Badge tone="danger">
                          <ShieldAlert className="size-3.5" /> Đen
                        </Badge>
                      ) : (
                        <Badge tone="primary">
                          <ShieldCheck className="size-3.5" /> Trắng
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-fg-muted">{e.note ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-fg-muted">{fmt.dateTime(e.createdAt)}</Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Xóa ${e.plateText}`}
                        loading={remove.isPending && remove.variables === e.id}
                        onClick={() => remove.mutate(e.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
