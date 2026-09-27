import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm pt-10">
      <LoginForm next={next?.startsWith("/") ? next : "/"} />
    </div>
  );
}
