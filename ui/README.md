# The do-anything surface

One page, three regions, fixed geometry: **ASK**, **RUNS**, **DETAIL**. None of
them resizes around its contents.

The premise is that a do-anything box adds no capability — it only changes what a
person can find and what they can trust. So the design work is not in the box; it
is in the two failures the box makes possible: a reader who cannot tell what the
system can do, and a reader who is shown a status where they were looking for an
outcome.

## Building

There is no bun on the host. Build in the container, from the **super-repo root**
— the design-token package lives outside this directory and must be inside the
mount:

```sh
cd <super-repo root>
docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/w/repos/human-surface-vessel/ui/.container-home \
  -v "$PWD":/w -w /w/repos/human-surface-vessel/ui \
  oven/bun:1 sh -c "bun install && bun run build"
```

`bun run build` is `tsc --noEmit && vite build`: the typecheck is part of the
build, so a type error fails the build rather than shipping.

## What it talks to

Everything goes through **this vessel's own proxy**, same-origin and relative.
Nothing in this bundle names a host. goal-host has no CORS and no inbound auth —
the server is the security boundary, it holds the API key, and the browser never
sees one.

| Route | Purpose |
|---|---|
| `POST /api/run-goal` | dispatch |
| `POST /api/resolve` | `goalWalkState`, `activeDispatches`, `solicitationResponse_write`, `poolImpulse_write` |
| `GET /api/discovery/shapes` | the live shape vocabulary, for starters |
| `POST /api/discovery/resolve` | `vesselCapability`, to confirm a shape has a producer |
| `POST /api/grade` | a human verdict into the oracle corpus |

The last two rows are the ones to check against the server: `/api/discovery/shapes`
is an assumed name for the proxied keyless `GET {discovery}/registry/shapes`, and
`/api/grade` **must** be added — a human verdict is `goal_verification_label_write`
against activity-api, which is not a goal-host shape and cannot go through
`/api/resolve`. See the contract note in `src/api/client.ts`.

## The rules this code is built to

Each is enforced in one place so it cannot drift:

| Rule | Where |
|---|---|
| P1 verdict over status | `lib/runState.ts` derives every verdict; each component that reads `status` also reads `reached` and renders only the derived verdict. The one place `status` appears on screen is the de-emphasised machine-record line in DETAIL, which prints `reached` beside it |
| P2 insert, never dispatch | `components/StarterChips.tsx` — the dispatch mutation is not reachable from it |
| P3 buffer, don't splice | `components/RunsRegion.tsx` |
| P4 stable domain keys | every list keys on `dispatchId` or a shape name |
| P5 comparator with a unique tiebreaker | `lib/sort.ts` — one comparator, and it ends on the tiebreaker |
| P6 pause + interval | `state/liveControls.tsx`, rendered in both live regions |
| P7 MECE verdicts, no agree button | `components/GradeGesture.tsx`, options from the token package |
| P8 content before its length | `components/EvidenceLedger.tsx` |
| P9 dispatch on form, verbatim default | `components/ContentRender.tsx` |
| P10 accepted and stalled are real states | `lib/runState.ts`, `lib/useProgressWatch.ts` |
| P11 no colour literal | `src/styles.css` — every colour is a `--sf-*` token |
| P12 no external host | no CDN, no webfont, no remote module; scan `dist/` to confirm |

And the standing omission: **no confidence percentage anywhere.** Planner
confidence in this system is uncalibrated — runs at confidence 0.0 outperform runs
at 0.9 — so a number would launder a known-bad signal into something that reads as
a measurement. The run contract shows a duration *band* and says where the band
came from.
