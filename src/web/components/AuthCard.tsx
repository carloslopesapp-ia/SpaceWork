import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthCard({ title, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-3xl font-bold tracking-tight text-indigo-600">SpaceWork</h1>
        <p className="mb-8 text-center text-sm text-slate-500">O seu espaço na cloud</p>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-slate-900">{title}</h2>
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
      </div>
    </main>
  );
}
