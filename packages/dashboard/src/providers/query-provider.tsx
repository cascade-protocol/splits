import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type ReactNode, useState } from "react";

interface QueryProviderProps {
	children: ReactNode;
}

/**
 * TanStack Query provider with optimized defaults for Solana data.
 */
export const QueryProvider: FC<QueryProviderProps> = ({ children }) => {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 30_000, // 30 seconds
						gcTime: 5 * 60_000, // 5 minutes
						refetchOnWindowFocus: true,
						retry: 2,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
};
