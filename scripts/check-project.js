const fs = require("node:fs");
const path = require("node:path");

const required = [
  "package.json",
  "src/main/main.js",
  "src/main/preload.js",
  "src/renderer/index.html",
  "src/renderer/renderer.mjs",
  "src/renderer/styles.css",
  "assets/icons/icon.svg",
  "assets/icons/icon.png",
  "assets/icons/icon.ico"
];

const missing = required.filter((file) => {
  return !fs.existsSync(path.join(process.cwd(), file));
});

if (missing.length > 0) {
  console.error("Missing required files:");
  for (const file of missing) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log("Project structure looks good.");
