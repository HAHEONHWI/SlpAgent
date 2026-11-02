import { copyFile } from "node:fs/promises";

// Hosting serves an existing index.html before rewrites; keep the SPA in app.html.
await copyFile(new URL("../dist/index.html", import.meta.url), new URL("../dist/app.html", import.meta.url));
await copyFile(new URL("../dist/home.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
