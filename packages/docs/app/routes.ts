import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
	route("api/search", "docs/search.ts"),
	index("docs/page.tsx", { id: "docs-index" }),
	route("*", "docs/page.tsx", { id: "docs-catchall" }),
] satisfies RouteConfig;
