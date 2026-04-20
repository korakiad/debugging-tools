#!/usr/bin/env node
import { main } from "../server/dist/index.js";

// Everything after the bin name is the user's own mocha command.
// Examples:
//   npx debug-gui                        → defaults to `npx mocha <spec>`
//   npx debug-gui mocha                  → `mocha <spec>`
//   npx debug-gui ./bin/mocha            → `./bin/mocha <spec>`
//   npx debug-gui node ./bin/mocha       → `node ./bin/mocha <spec>`
//   npx debug-gui mocha --timeout 30000  → `mocha --timeout 30000 <spec>`
const commandTokens = process.argv.slice(2);

const port = process.env.PORT ? Number(process.env.PORT) : 5555;
main(process.cwd(), port, commandTokens).catch((e) => {
    console.error(e);
    process.exit(1);
});
