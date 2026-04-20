#!/usr/bin/env node
import { main } from "../server/dist/index.js";

const port = process.env.PORT ? Number(process.env.PORT) : 5555;
main(process.cwd(), port).catch((e) => {
    console.error(e);
    process.exit(1);
});
