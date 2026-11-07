declare module "ffprobe-static" {
  /** Absolute path to the bundled ffprobe binary for this platform. */
  const ffprobe: { path: string };
  export default ffprobe;
}
