import Link from "next/link";
export function Nav() {
  return <nav className="border-b bg-white"><div className="mx-auto flex max-w-6xl gap-4 px-4 py-3 text-sm font-medium"><Link href="/">Dashboard</Link><Link href="/activities">Activities</Link><Link href="/import">Import</Link></div></nav>;
}
