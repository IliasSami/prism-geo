"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button, Card, EmptyState, LinkButton } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";

/** A page that threw: say so plainly, offer a retry, and point to the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <EmptyState
        icon={<LogoMark className="h-7 w-7 text-zinc-400" wedge="fill-red-600 stroke-red-600" />}
        title="This page couldn't load"
        description={
          <>
            <p>Something went wrong on the server while reading your data. Nothing was changed.</p>
            {error.digest && <p className="mt-1 text-xs text-zinc-500">Reference: {error.digest} (Settings → Data → Server log has the details)</p>}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Try again
            </Button>
            <LinkButton href="/settings?tab=data">Open server log</LinkButton>
          </div>
        }
      />
    </Card>
  );
}
