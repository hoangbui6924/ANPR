import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, UserPlus, X } from "lucide-react";
import { api } from "@/api";
import type { Role, User } from "@/api/types";
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
  // password modal: passwords are stored hashed (bcrypt), so the admin cannot read one, only set a new one
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const openPw = (u: User) => {
    setPwUser(u);
    setNewPw("");
    setShowPw(false);
    setPassword.reset();
  };
  const setPassword = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => api.updateUser(id, { password }),
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
                  <Th>Mật khẩu</Th>
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
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tracking-widest text-fg-muted" aria-hidden>
                            ••••••••
                          </span>
                          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => openPw(u)} aria-label={`Mật khẩu của ${u.username}`} title="Mật khẩu">
                            <Eye className="size-4" />
                          </Button>
                        </div>
                      </Td>
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

      {pwUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPwUser(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Mật khẩu của ${pwUser.username}`}
            className="w-full max-w-md rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">Mật khẩu tài khoản</h2>
                <p className="text-sm text-fg-muted">
                  {pwUser.fullName} · @{pwUser.username}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPwUser(null)} aria-label="Đóng">
                <X className="size-4" />
              </Button>
            </div>
            <form
              className="space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                setPassword.mutate({ id: pwUser.id, password: newPw });
              }}
            >
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-fg-muted">
                Mật khẩu được lưu dạng mã hóa một chiều nên không thể xem lại mật khẩu cũ. Bạn có thể đặt mật khẩu mới cho tài khoản này.
              </p>
              <div>
                <Label htmlFor="newPassword">Mật khẩu mới</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPw ? "text" : "password"}
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    className="pr-10"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-fg-muted hover:text-fg"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-fg-muted">Tối thiểu 8 ký tự.</p>
              </div>
              {setPassword.isError && <ErrorBox error={setPassword.error} />}
              {setPassword.isSuccess && (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Đã đặt mật khẩu mới cho @{pwUser.username}.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setPwUser(null)}>
                  Đóng
                </Button>
                <Button type="submit" loading={setPassword.isPending}>
                  <KeyRound className="size-4" /> Đặt mật khẩu
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
