import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Surface } from "./Surface";

/**
 * The surface is the ROOT component, so moving between questions
 * keeps the rail, its scroll position and the question snapshot mounted. The
 * child routes exist only to carry the open item in the URL.
 */
const rootRoute = createRootRoute({ component: Surface });
const Empty = (): null => null;

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Empty,
});

const questionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/question/$questionId",
  component: Empty,
});

const routeTree = rootRoute.addChildren([indexRoute, questionRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
