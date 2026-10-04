import { useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { BarChart3, FlaskConical, History, ListChecks, LogOut, Menu, ScanLine, Users, X } from "lucide-react";
import { USE_MOCK } from "@/api";
import { Badge, Spinner } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/recognize", label: "Nhận dạng", icon: ScanLine },
  { to: "/history", label: "Lịch sử", icon: History },
  { to: "/lists", label: "Danh sách xe", icon: ListChecks },
  { to: "/stats", label: "Thống kê", icon: BarChart3 },
  { to: "/users", label: "Người dùng", icon: Users, adminOnly: true },
];

export function AppLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const nav = NAV.filter((n) => !n.adminOnly || user.role === "admin");

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-lg bg-primary text-white">
          <ScanLine className="size-5" />
        </div>
        <div>
          <p className="font-semibold text-white">ANPR</p>
          <p className="text-xs text-sidebar-fg/70">Nhận dạng biển số</p>
        </div>
      </div>
      <ul className="flex-1 space-y-1 px-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white",
                )
              }
            >
              <Icon className="size-4.5" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
        <p className="text-xs text-sidebar-fg/70">{user.role === "admin" ? "Quản trị viên" : "Nhân viên"}</p>
        <button
          onClick={logout}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-4" /> Đăng xuất
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur lg:px-6">
          <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Mở menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <p className="font-semibold lg:hidden">ANPR</p>
          <div className="ml-auto flex items-center gap-2">
            {USE_MOCK && (
              <Badge tone="warning" title="Đang dùng dữ liệu mô phỏng (VITE_USE_MOCK=true)">
                <FlaskConical className="size-3.5" /> Dữ liệu mô phỏng
              </Badge>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-fg lg:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "admin" ? <>{children}</> : <Navigate to="/recognize" replace />;
}
