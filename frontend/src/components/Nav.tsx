"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/src/components/ThemeToggle";
import { useSettings } from "@/src/components/SettingsContext";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/activities", label: "Activities" },
  { href: "/import", label: "Import" },
];

export function Nav() {
  const pathname = usePathname();
  const settings = useSettings();
  return (
    <nav className="app-nav">
      <div className="nav-inner">
        <div className="flex items-center gap-3">
          <Link href="/" className="nav-brand">Run Tracker</Link>
          <div className="nav-links" aria-label="Primary navigation">
            {links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return <Link key={link.href} href={link.href} className={`nav-link ${active ? "nav-link-active" : ""}`}>{link.label}</Link>;
            })}
          </div>
        </div>
        <div className="toolbar"><button className="btn btn-sm" onClick={settings.open}>Settings</button><ThemeToggle /></div>
      </div>
    </nav>
  );
}
