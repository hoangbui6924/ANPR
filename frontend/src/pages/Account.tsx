import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound } from "lucide-react";
import { api } from "@/api";
import { PageHeader } from "@/components/AppLayout";
import { Badge, Button, Card, CardHeader, ErrorBox, Input, Label } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/utils";

export function AccountPage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  const mismatch = confirm.length > 0 && confirm !== next;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) change.mutate();
  };

  return (
    <>
      <PageHeader title="Tài khoản" description="Thông tin tài khoản và đổi mật khẩu đăng nhập." />
      <div className="grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="self-start">
          <CardHeader title="Thông tin" />
          <dl className="space-y-3 p-5 text-sm">
            <div>
              <dt className="text-fg-muted">Họ tên</dt>
              <dd className="font-medium">{user?.fullName}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Tên đăng nhập</dt>
              <dd className="font-medium">@{user?.username}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Vai trò</dt>
              <dd>
                <Badge tone={user?.role === "admin" ? "primary" : "neutral"}>{user?.role === "admin" ? "Quản trị viên" : "Nhân viên"}</Badge>
              </dd>
            </div>
            {user && (
              <div>
                <dt className="text-fg-muted">Ngày tạo</dt>
                <dd>{fmt.dateTime(user.createdAt)}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Đổi mật khẩu" />
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <Label htmlFor="current">Mật khẩu hiện tại</Label>
              <Input id="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="next">Mật khẩu mới</Label>
              <Input id="next" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
              <p className="mt-1 text-xs text-fg-muted">Tối thiểu 8 ký tự.</p>
            </div>
            <div>
              <Label htmlFor="confirm">Nhập lại mật khẩu mới</Label>
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {mismatch && <p className="mt-1 text-xs text-danger">Mật khẩu nhập lại không khớp.</p>}
            </div>
            {change.isError && <ErrorBox error={change.error} />}
            {change.isSuccess && (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                <CheckCircle2 className="size-4" /> Đã đổi mật khẩu.
              </p>
            )}
            <Button type="submit" className="w-full" loading={change.isPending} disabled={mismatch}>
              <KeyRound className="size-4" /> Đổi mật khẩu
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
