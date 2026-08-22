import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import vhsGrammar from "../syntaxes/vhs.tmLanguage.json" with { type: "json" };

const languages = [{ ...vhsGrammar, aliases: ["tape"], name: "vhs" }];

export default defineConfig({
  site: "https://willibrandon.github.io",
  base: "/vscode-vhs",
  trailingSlash: "always",
  publicDir: "../media",
  integrations: [
    starlight({
      title: "VHS",
      description: "VHS editing in Visual Studio Code.",
      favicon: "/icon.svg",
      customCss: ["./src/styles/docs.css"],
      credits: false,
      components: {
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      expressiveCode: {
        shiki: {
          langs: languages,
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/willibrandon/vscode-vhs",
        },
      ],
      sidebar: [
        { slug: "", label: "Overview" },
        { slug: "getting-started" },
        { slug: "editing" },
        { slug: "running-tapes" },
        { slug: "source-tapes" },
        { slug: "settings" },
        { slug: "commands" },
        { slug: "privacy-and-trust" },
        { slug: "troubleshooting" },
      ],
    }),
    sitemap(),
  ],
});
