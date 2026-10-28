"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Renders nothing on the given route prefix (e.g. the header actions during onboarding). */
export function HideOn({ prefix, children }: { prefix: string; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith(prefix)) return null;
  return <>{children}</>;
}
