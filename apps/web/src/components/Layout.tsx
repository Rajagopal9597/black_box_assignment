import { Link, Outlet, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Docshare
        </Link>
        {user && (
          <div className="topbar-user">
            <span className="muted">{user.email}</span>
            <button
              className="btn-link"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}
