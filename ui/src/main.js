import { jsx as _jsx } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import { LiveControlsProvider } from "./state/liveControls";
import "./styles.css";
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // A poll that fails must not blank a region the reader is using, and it
            // must not retry so hard that a dead proxy becomes a request storm.
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});
const container = document.getElementById("root");
if (!container)
    throw new Error("#root is missing from the document");
createRoot(container).render(_jsx(StrictMode, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(LiveControlsProvider, { children: _jsx(RouterProvider, { router: router }) }) }) }));
//# sourceMappingURL=main.js.map