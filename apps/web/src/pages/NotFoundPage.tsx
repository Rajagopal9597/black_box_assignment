import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section>
      <h1>Page not found</h1>
      <Link to="/">Go home</Link>
    </section>
  );
}
