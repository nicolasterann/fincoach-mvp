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
      <div className="mt-auto flex flex-col gap-3 px-3">
        <Link
          href="/app/settings"
          className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
            isActive(pathname, "/app/settings")
              ? "bg-emerald-400/10 text-emerald-300"
              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          }`}
        >
          <Icon d="M10.3 3.3a1.5 1.5 0 0 1 3.4 0l.2 1.1a7 7 0 0 1 1.7 1l1-.5a1.5 1.5 0 0 1 1.9 2l-.5 1a7 7 0 0 1 0 2l.5 1a1.5 1.5 0 0 1-1.9 2l-1-.5a7 7 0 0 1-1.7 1l-.2 1.1a1.5 1.5 0 0 1-3.4 0l-.2-1.1a7 7 0 0 1-1.7-1l-1 .5a1.5 1.5 0 0 1-1.9-2l.5-1a7 7 0 0 1 0-2l-.5-1a1.5 1.5 0 0 1 1.9-2l1 .5a7 7 0 0 1 1.7-1ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
          Ajustes
        </Link>
        <form action={signOutAction}>
          <button className="text-xs font-medium text-zinc-600 transition hover:text-zinc-300" type="submit">
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}

export function AppBottomNav() {
  const pathname = usePathname();
  // The chat owns the bottom of the screen (input + keyboard); hiding the tab
  // bar there is the native DM pattern and removes the keyboard/nav conflict.
  if (pathname.startsWith("/app/chat")) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
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
