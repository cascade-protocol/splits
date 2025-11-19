.PHONY: check test build lint bench clean

check: build lint test bench

test:
	cd programs/cascade-splits && cargo test
	cd sdk && pnpm test

build:
	anchor build
	cd sdk && pnpm build

lint:
	cd programs/cascade-splits && cargo check
	cd sdk && pnpm type-check

bench:
	cd programs/cascade-splits && cargo bench

clean:
	anchor clean
	cd sdk && pnpm clean
