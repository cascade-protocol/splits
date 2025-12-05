# @cascade-fyi/tabs-sdk

TypeScript SDK for Cascade Tabs - x402 payment authorization via Squads Smart Accounts.

## Installation

```bash
npm install @cascade-fyi/tabs-sdk
# or
pnpm add @cascade-fyi/tabs-sdk
```

## Peer Dependencies

Requires `@solana/kit` >= 2.0.0

## Usage

```typescript
import {
  // Generated instructions
  getCreateSmartAccountInstruction,
  getAddSpendingLimitAsAuthorityInstruction,
  fetchMaybeSettings,

  // PDA derivation
  deriveSettings,
  deriveSmartAccount,
  deriveSpendingLimit,

  // Account discovery
  fetchSmartAccountStateByOwner,

  // Constants
  PERMISSION_ALL,
} from "@cascade-fyi/tabs-sdk";
```

### x402 Payment Client

```typescript
import { tabsFetch } from "@cascade-fyi/tabs-sdk";

// Drop-in replacement for fetch() that handles x402 payments
const response = await tabsFetch("https://api.example.com/paid-endpoint", {
  apiKey: "tabs_...",
  facilitatorUrl: "https://tabs.cascade.fyi",
});
```

## License

Apache-2.0
