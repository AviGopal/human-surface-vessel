import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Surface } from "./Surface";

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Surface,
});

/**
 * The detail panel is a ROUTE, not a piece of component state. A run a reader
 * is looking at survives a reload, can be linked to, and is where the browser's
 * back button expects it to be.
 */
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/run/$dispatchId",
  component: Surface,
});

const routeTree = rootRoute.addChildren([indexRoute, runRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
