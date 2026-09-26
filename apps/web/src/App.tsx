import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SharePage } from "./pages/SharePage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { WorkspacePage } from "./pages/workspace/WorkspacePage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/s/:token" element={<SharePage />} />
        {/* Signed-in */}
        <Route
          index
          element={
            <RequireAuth>
              <WorkspacesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/workspaces/:workspaceId"
          element={
            <RequireAuth>
              <WorkspacePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
