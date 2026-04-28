// Vitest runs in jsdom which lacks Web Workers. Pierre's portable worker URL
// is aliased to this file so the import resolves; the empty data-URL default
// export is what `new URL(...).href` will see, and FileDiff in the test env
// just doesn't spin up a real worker.
export default "data:text/javascript,";
