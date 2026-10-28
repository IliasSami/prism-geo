import type { Metadata } from "next";

export const metadata: Metadata = { title: "Add a client" };

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
