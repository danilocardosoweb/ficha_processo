declare module "proper-lockfile" {
  export type LockOptions = {
    realpath?: boolean;
    stale?: number;
    update?: number;
    retries?: number | { retries?: number; minTimeout?: number; maxTimeout?: number };
    onCompromised?: (error: Error) => void;
  };

  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;

  const properLockfile: { lock: typeof lock };
  export default properLockfile;
}
