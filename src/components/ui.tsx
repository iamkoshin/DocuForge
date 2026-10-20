"use client";

import React from "react";

export const fileUrl = (rel: string, download = false) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`;
export const projectFile = (id: string, name: string, download = false) => fileUrl(`projects/${id}/${name}`, download);

export function fmtDuration(sec?: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
export const fmtUsd = (n?: number | null) => (n == null ? "—" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { status: number; data: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean; size?: "sm" | "md" };
export function Button({ variant = "secondary", busy, size = "md", className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-cobalt text-white hover:bg-[#1f3aa8] border-cobalt",
    secondary: "bg-panel text-ink border-line hover:border-ink/40",
    ghost: "bg-transparent text-sub border-transparent hover:text-ink hover:bg-line/40",
    danger: "bg-panel text-bad border-bad/40 hover:bg-bad-soft",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button {...rest} disabled={disabled || busy} className={`inline-flex items-center gap-2 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {busy && <span className="size-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-sub">{hint}</p>}
    </div>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm placeholder:text-sub/60 focus:border-cobalt focus:outline-none";

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-line/60 text-sub" },
  running: { label: "Working", cls: "bg-cobalt-soft text-cobalt" },
  waiting: { label: "Needs your review", cls: "bg-warn-soft text-warn" },
  failed: { label: "Failed", cls: "bg-bad-soft text-bad" },
  done: { label: "Ready", cls: "bg-ok-soft text-ok" },
  pending: { label: "Not started", cls: "bg-line/60 text-sub" },
  skipped: { label: "Skipped", cls: "bg-line/60 text-sub" },
};
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-line text-sub" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-panel ${className}`}>{children}</section>;
}

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>;
}
