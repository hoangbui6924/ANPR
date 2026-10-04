import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { api } from "@/api";
import type { Role } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card, CardHeader, ErrorBox, Input, Label, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/utils";

export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: "", fullName: "", role: "staff" as Role, password: "" });

  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const add = useMutation({
    mutationFn: () => api.addUser(form),
    onSuccess: () => {
      setForm({ username: "", fullName: "", role: "staff", password: "" });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; role?: Role; active?: boolean }) => api.updateUser(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <>
      <PageHeader title="Người dùng" description="Quản lý tài khoản: admin quản lý người dùng và xóa dữ liệu, staff nhận dạng và tra cứu." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Thêm tài khoản" />
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <Label htmlFor="username">Tên đăng nhập</Label>
              <Input id="username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} />
            </div>
            <div>
              <Label htmlFor="fullName">Họ tên</Label>
              <Input id="fullName" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="role">Vai trò</Label>
              <Select id="role" className="w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="staff">Nhân viên (staff)</option>
                <option value="admin">Quản trị (admin)</option>
              </Select>
            </div>
            {add.isError && <ErrorBox error={add.error} />}
            <Button type="submit" className="w-full" loading={add.isPending}>
              <UserPlus className="size-4" /> Tạo tài khoản
            </Button>
          </form>
        </Card>

        <Card>
          {users.isError && (
            <div className="p-4">
              <ErrorBox error={users.error} />
            </div>
          )}
          {users.isLoading && (
            <div className="grid place-items-center py-16">
              <Spinner />
            </div>
          )}
          {users.data && (
            <Table>
              <thead>
                <tr>
                  <Th>Tài khoản</Th>
                  <Th>Vai trò</Th>
                  <Th>Trạng thái</Th>
                  <Th>Ngày tạo</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className="hover:bg-muted/50">
                      <Td>
                        <p className="font-medium">{u.fullName}</p>
                        <p className="text-xs text-fg-muted">@{u.username}</p>
                      </Td>
                      <Td>
                        <Select
                          aria-label={`Vai trò của ${u.username}`}
                          className="h-8"
                          value={u.role}
                          disabled={self}
                          onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}
                        >
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                        </Select>
                      </Td>
                      <Td>{u.active ? <Badge tone="success">Hoạt động</Badge> : <Badge>Đã khóa</Badge>}</Td>
                      <Td className="whitespace-nowrap text-fg-muted">{fmt.dateTime(u.createdAt)}</Td>
                      <Td className="text-right">
                        {!self && (
                          <Button variant="secondary" size="sm" onClick={() => update.mutate({ id: u.id, active: !u.active })}>
                            {u.active ? "Khóa" : "Mở khóa"}
                          </Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
