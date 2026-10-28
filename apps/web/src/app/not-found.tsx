import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<LogoMark className="h-7 w-7 text-zinc-400" wedge="fill-zinc-400 stroke-zinc-400" />}
        title="Page not found"
        description="This page doesn't exist. It may have moved: Visibility is now Competitors, and Opportunities is now Gaps."
        action={
          <LinkButton href="/" variant="primary">
            Back to Overview <ArrowRight className="h-4 w-4" aria-hidden />
          </LinkButton>
        }
      />
    </Card>
  );
}
