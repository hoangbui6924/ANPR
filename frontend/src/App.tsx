import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout, RequireAdmin } from "@/components/AppLayout";
import { EmptyState, Spinner } from "@/components/ui";
import { HistoryPage } from "@/pages/History";
import { ListsPage } from "@/pages/Lists";
import { LoginPage } from "@/pages/Login";
import { RecognizePage } from "@/pages/Recognize";
import { UsersPage } from "@/pages/Users";

// charts (recharts) are heavy: load the stats page on demand
const StatsPage = lazy(() => import("@/pages/Stats").then((m) => ({ default: m.StatsPage })));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/recognize" replace />} />
        <Route path="/recognize" element={<RecognizePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/lists" element={<ListsPage />} />
        <Route
          path="/stats"
          element={
            <Suspense fallback={<Spinner className="mx-auto mt-24" />}>
              <StatsPage />
            </Suspense>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="*"
          element={
            <EmptyState title="Không tìm thấy trang">
              <Link className="text-primary underline" to="/recognize">
                Về trang nhận dạng
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
