/** Vite: `?raw` imports give a file's text. */
declare module '*.txt?raw' {
  const text: string;
  export default text;
}
