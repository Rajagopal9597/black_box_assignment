import { ApiError } from "../api/client";

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  let message = "Something went wrong";
  if (error instanceof ApiError) {
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  return <p className="error">{message}</p>;
}
