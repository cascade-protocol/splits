/**
 * Dashboard Page
 *
 * Routes to the appropriate chain-specific dashboard based on context.
 */

import { useChain } from "@/contexts/chain-context";
import { SolanaDashboard } from "./SolanaDashboard";
import { EvmDashboard } from "./EvmDashboard";

export function Dashboard() {
  const { isSolana } = useChain();

  return isSolana ? <SolanaDashboard /> : <EvmDashboard />;
}
