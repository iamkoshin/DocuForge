"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Videos" },
  { href: "/new", label: "New video" },
  { href: "/sfx", label: "Sound library" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/projects") : path.startsWith(href));
  return (
    <nav className="md:w-56 md:min-h-screen md:border-r border-b md:border-b-0 border-line bg-panel/60 px-4 py-4 md:px-5 md:py-8 flex md:flex-col gap-1 md:gap-8 items-center md:items-stretch overflow-x-auto">
      <Link href="/" className="font-serif text-xl font-semibold tracking-tight mr-4 md:mr-0 whitespace-nowrap">
        DocuForge
      </Link>
      <ul className="flex md:flex-col gap-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={`block rounded-md px-3 py-2 text-sm whitespace-nowrap ${active(l.href) ? "bg-ink text-white" : "text-sub hover:text-ink hover:bg-line/50"}`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
