deployer := "~/.config/solana/deployer.json"
idl_output := "sdk/src/idl/"

check: build lint test-integration bench

build:
  anchor build
  cp target/idl/cascade_splits.json sdk/idl.json
  cd sdk && pnpm build

build-verifiable:
  anchor build --verifiable
  cp target/idl/cascade_splits.json sdk/idl.json
  cd sdk && pnpm build

test-integration:
  cd programs/cascade-splits && cargo test
  cd programs/cascade-splits && cargo bench
  cd sdk && pnpm test

test-localnet:
  anchor test --provider.cluster localnet

lint:
	cd programs/cascade-splits && cargo check
	cd sdk && pnpm type-check

bench:
  cd programs/cascade-splits && cargo bench

clean:
	anchor clean
	cd sdk && pnpm clean

init-devnet:
  pnpm tsx scripts/initialize-protocol.ts devnet {{deployer}}
test-devnet:
  anchor test --provider.wallet {{deployer}} --skip-deploy --skip-build --provider.cluster devnet

init-mainnet:
  pnpm tsx scripts/initialize-protocol.ts mainnet {{deployer}}
test-mainnet:
  anchor test --provider.wallet {{deployer}} --skip-deploy --skip-build --provider.cluster mainnet

get-protocol-config-devnet:
  pnpm tsx scripts/get-protocol-config.ts devnet
get-protocol-config-mainnet:
  pnpm tsx scripts/get-protocol-config.ts mainnet

update-fee-wallet-devnet new_fee_wallet:
  pnpm tsx scripts/update-fee-wallet.ts devnet {{deployer}} {{new_fee_wallet}}
update-fee-wallet-mainnet new_fee_wallet:
  pnpm tsx scripts/update-fee-wallet.ts mainnet {{deployer}} {{new_fee_wallet}}