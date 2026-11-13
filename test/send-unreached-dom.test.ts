/**
 * A send that no producer answered (a gateway's 502, 503 or 504: a link between machines down,
 * or the owner not up) tells the person so in plain words, with the ask kept in the box; what
 * the system itself said is one hover away. A producer's own refusal keeps its words.
 *
 * Shape: the hub surface 11-13. An ask came back "Not sent: ingress proxy failed: failed to
 * connect via relay with status NO_RESERVATION".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let signedIn = true;
const LINK = "ingress proxy failed: failed to connect via relay with status NO_RESERVATION";
let ANSWER: () => Response = () => Response.json({ error: LINK }, { status: 502 });
const calls: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  calls.push({ url, body });
  const person = { userId: "user:person-a", name: "Person A", email: "person-a@example.test", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/key")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
  if (url.endsWith("/api/surface-intent")) {
    return String(body["instruction"]) === "show this as a table" ? Response.json({ view: { form: "rows" } }) : new Response("{}", { status: 422 });
  }
  if (url.endsWith("/api/discovery/resolve")) return ANSWER();
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({ resolved: true, success: true, body: {} });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  calls.length = 0;
  signedIn = true;
  ANSWER = () => Response.json({ error: LINK }, { status: 502 });
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false })))),
    );
  });
  await settle();
  return el;
}

const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function typeInBox(el: HTMLElement, text: string): Promise<void> {
  const box = el.querySelector("textarea")!;
  await act(async () => setValue(box, text));
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

describe("a send nothing answered", () => {
  test("must-fail: says in plain words it could not reach the system, keeps the ask, and holds the system's words on hover", async () => {
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    const line = el.querySelector(".sf-outcome-line span") as HTMLElement;
    expect(line.textContent).toBe("Not sent: the system couldn't be reached just now. Try again.");
    expect(el.textContent).not.toContain("NO_RESERVATION");
    expect(line.title).toBe(LINK);
    // Drawn as a failure, not in the colour of a send that went.
    expect(line.closest(".sf-outcome-line")!.getAttribute("data-tone")).toBe("error");
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("What time is it in Lisbon?");
  });

  test("must-fail: the surface not answering at all reads the same", async () => {
    ANSWER = () => { throw new TypeError("network"); };
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    expect(el.querySelector(".sf-outcome-line span")!.textContent).toBe("Not sent: the system couldn't be reached just now. Try again.");
  });

  test("must-fail: a producer's own refusal keeps its words, drawn as a failure", async () => {
    ANSWER = () => Response.json({ error: "row refused", detail: "what is longer than allowed" }, { status: 400 });
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    expect(el.querySelector(".sf-outcome-line span")!.textContent).toBe("Not sent: row refused: what is longer than allowed");
    expect(el.querySelector(".sf-outcome-line")!.getAttribute("data-tone")).toBe("error");
  });

  test("control: a send that went is drawn as one", async () => {
    ANSWER = () => Response.json({ ok: true, seq: 301 });
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    expect(el.querySelector(".sf-outcome-line span")!.textContent).toContain("Asked (record #301).");
    expect(el.querySelector(".sf-outcome-line")!.getAttribute("data-tone")).toBe("ok");
  });
});
