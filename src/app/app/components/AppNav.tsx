"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOutAction } from "../actions";

// Kipu app navigation. Mental model: dashboard = feed, chat = DMs. Bottom tab
// bar on mobile, left sidebar on desktop — both driven by the same item list so
// the IA stays consistent across breakpoints.

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Resumen", icon: <Icon d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5" /> },
  {
    href: "/app/activity",
    label: "Actividad",
    icon: <Icon d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    href: "/app/chat",
    label: "Kipu",
    icon: <Icon d="M4 5h16v11H8l-4 4V5Z" />,
  },
  { href: "/app/goals", label: "Metas", icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" /> },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/5 px-4 py-7 lg:flex">
      <Link href="/app" className="px-3 text-lg font-black tracking-tight text-emerald-400">
        Kipu
      </Link>
      <nav className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
      <form action={signOutAction} className="mt-auto px-3">
        <button
          className="text-xs font-medium text-zinc-600 transition hover:text-zinc-300"
          type="submit"
        >
          Cerrar sesión
        </button>
      </form>
    </aside>
  );
}

export function AppBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/90 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium transition ${
                active ? "text-emerald-300" : "text-zinc-500"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
