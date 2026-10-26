// Tasks Vision 0.10.32 tries importScripts(), then calls self.import() on
// module-worker TypeError. Its WASM loader is a classic script with a CommonJS
// export, not an ES module. Capture that existing export while importing it
// natively; no eval, transformed dependency, bundler, or classic worker needed.
export function installWorkerRuntimeImport(scope, importModule = (url) => import(url)) {
  // The classic loader's debug fallback declares a function inside a block.
  // ES-module strict mode does not hoist it out of that block (Annex B).
  // Supply the documented-by-source hook for the worker runtime's lifetime.
  scope.custom_dbg ??= (...args) => console.warn(...args);
  scope.import = async (url) => {
    const previousModule = scope.module;
    const previousExports = scope.exports;
    const module = { exports: {} };
    scope.module = module;
    scope.exports = module.exports;
    try {
      await importModule(url);
      const factory = module.exports.default ?? module.exports;
      if (typeof factory !== "function") throw new Error("WASM runtime did not export its module factory");
      scope.ModuleFactory = factory;
    } finally {
      if (previousModule === undefined) delete scope.module;
      else scope.module = previousModule;
      if (previousExports === undefined) delete scope.exports;
      else scope.exports = previousExports;
    }
  };
}
