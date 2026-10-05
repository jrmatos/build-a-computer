/** Vite: `?worker&url` imports give the URL of the bundled worker script. */
declare module '*?worker&url' {
  const url: string;
  export default url;
}
