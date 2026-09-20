/**
 * Goals, human participation, runs and evidence share a page. Run arrivals and
 * question updates are buffered so they do not displace work being inspected.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AskRegion } from "./components/AskRegion";
import { DetailPanel } from "./components/DetailPanel";
import { GapStrip } from "./components/GapStrip";
import { RunsRegion } from "./components/RunsRegion";
import { ParticipationRegion } from "./components/ParticipationRegion";
import { useRenderPolicy } from "./api/queries";
import { useLiveControls } from "./state/liveControls";
import { useTokenOverrides } from "./lib/useTokenOverrides";

export function Surface(): ReactNode {
  // The live behaviour impulse, applied to :root at use time. An override
  // written while this page is open repaints it without a reload — which is how
  // a legibility fix becomes visible to the person the fix is for.
  const { paused, intervalMs } = useLiveControls();
  const policy = useRenderPolicy({ enabled: !paused, intervalMs }).data;
  useTokenOverrides(policy?.tokenOverrides);

  const navigate = useNavigate();
  // The detail panel is addressable: a run's URL is shareable and survives a
  // reload. It holds until dismissed — nothing closes it but the reader.
  const params = useParams({ strict: false }) as { dispatchId?: string };
  const selected = params.dispatchId ?? null;

  const open = (dispatchId: string): void => {
    void navigate({ to: "/run/$dispatchId", params: { dispatchId } });
  };

  return (
    <main className="sf-app">
      {/*
        * The document had no `h1` at all, so its heading outline started at
        * `h2: Ask` with nothing above it — a screen reader's heading list had
        * no root. A visually hidden title supplies that document outline.
        */}
      <h1 className="sf-visually-hidden">The do-anything surface</h1>
      <AskRegion onDispatched={open} />
      <ParticipationRegion />
      <RunsRegion selectedDispatchId={selected} onSelect={open} />
      <DetailPanel dispatchId={selected} />
      <GapStrip />
    </main>
  );
}
