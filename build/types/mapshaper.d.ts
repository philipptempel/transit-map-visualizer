declare module "mapshaper" {
  const mapshaper: {
    /** Runs mapshaper commands on in-memory files; resolves to the output files by name. */
    applyCommands(commands: string, input?: Record<string, unknown>): Promise<Record<string, string | Uint8Array>>;
  };
  export default mapshaper;
}
