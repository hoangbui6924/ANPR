import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { USE_MOCK } from "@/api";
import { Button, Card, ErrorBox, Input, Label } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/recognize";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-primary text-white">
            <ScanLine className="size-6" />
          </div>
          <h1 className="mt-3 text-xl font-semibold">Đăng nhập ANPR</h1>
          <p className="mt-1 text-sm text-fg-muted">Hệ thống nhận dạng biển số xe máy và ô tô</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="username">Tên đăng nhập</Label>
            <Input id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Mật khẩu</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {!!error && <ErrorBox error={error} />}
          <Button type="submit" className="w-full" loading={pending}>
            Đăng nhập
          </Button>
        </form>
        {USE_MOCK && (
          <p className="mt-5 rounded-lg bg-muted px-3 py-2 text-center text-xs text-fg-muted">
            Chế độ mô phỏng: đăng nhập <b>admin</b> hoặc <b>staff</b> với mật khẩu bất kỳ.
          </p>
        )}
      </Card>
    </div>
  );
}
