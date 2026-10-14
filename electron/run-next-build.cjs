const { spawn } = require("node:child_process");

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    TECNOMES_LOCAL_MODE: "true",
    TECNOMES_APP_ENVIRONMENT: "desktop",
  },
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
