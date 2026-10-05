/**
 * The content tests import @build-a-computer/js-check, whose browser runner
 * loads its worker with a Vite `?worker&url` import. Declared here too so
 * this package's `tsc` resolves it (js-check declares it for itself).
 */
declare module '*?worker&url' {
  const url: string;
  export default url;
}
