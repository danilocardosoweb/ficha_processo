const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "node_modules", "better-sqlite3");
const destination = path.join(projectRoot, ".next", "standalone", "node_modules", "better-sqlite3");

if (!fs.existsSync(source)) throw new Error("Driver SQLite não encontrado em node_modules.");
if (!fs.existsSync(path.dirname(destination))) throw new Error("Build standalone não encontrado. Execute a compilação desktop antes de empacotar.");

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
console.log("Driver SQLite preparado para o runtime do Electron.");
