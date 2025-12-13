// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  srcDir: ".", // Use docs/ as src root instead of docs/src/
  integrations: [
    starlight({
      title: "Cascade Splits",
      description:
        "Permissionless payment splitter for Solana and Base. Distributes tokens from vault to recipients by percentage.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/cascade-protocol/splits",
        },
        {
          icon: "x.com",
          label: "X",
          href: "https://x.com/cascade_fyi",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ label: "Introduction", slug: "index" }],
        },
        {
          label: "Specification",
          items: [
            { label: "Solana", slug: "specification/solana" },
            { label: "EVM (Base)", slug: "specification/evm" },
            { label: "Glossary", slug: "specification/glossary" },
          ],
        },
        {
          label: "Architecture Decision Records",
          autogenerate: { directory: "adr" },
        },
        {
          label: "Benchmarks",
          autogenerate: { directory: "benchmarks" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
      customCss: [],
      editLink: {
        baseUrl:
          "https://github.com/cascade-protocol/splits/edit/main/apps/docs/content/docs/",
      },
    }),
  ],
});
