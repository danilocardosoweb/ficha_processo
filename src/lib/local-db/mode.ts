import "server-only";

/** True only for the installable, offline edition of TecnoMES. */
export function isLocalDesktopMode() {
  return process.env.TECNOMES_LOCAL_MODE === "true" || process.env.TECNOMES_APP_ENVIRONMENT === "desktop";
}
