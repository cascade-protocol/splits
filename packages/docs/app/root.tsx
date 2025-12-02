import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";
import { RootProvider } from "fumadocs-ui/provider/react-router";
import type { Route } from "./+types/root";
import "./app.css";
import SearchDialog from "@/components/search";

export const links: Route.LinksFunction = () => [
	{ rel: "icon", type: "image/svg+xml", href: "/water-wave-cascade.svg" },
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
	},
];

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Cascade Docs - Payment Splitting Documentation" },
		{
			name: "description",
			content:
				"Documentation for Cascade Splits - permissionless payment splitting on Solana. Learn how to create vaults, distribute tokens, and integrate with the SDK.",
		},
		{ property: "og:type", content: "website" },
		{ property: "og:url", content: "https://docs.cascade.fyi/" },
		{ property: "og:title", content: "Cascade Docs" },
		{
			property: "og:description",
			content: "Documentation for Cascade Splits - permissionless payment splitting on Solana",
		},
		{ property: "og:image", content: "https://cascade.fyi/og-image.png" },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:site", content: "@cascade_fyi" },
		{ name: "twitter:title", content: "Cascade Docs" },
		{
			name: "twitter:description",
			content: "Documentation for Cascade Splits - permissionless payment splitting on Solana",
		},
		{ name: "twitter:image", content: "https://cascade.fyi/og-image.png" },
	];
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body className="flex min-h-screen flex-col">
				<RootProvider
					search={{ SearchDialog }}
					theme={{ defaultTheme: "dark" }}
				>
					{children}
				</RootProvider>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? "The requested page could not be found."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="container mx-auto p-4 pt-16">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full overflow-x-auto p-4">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
