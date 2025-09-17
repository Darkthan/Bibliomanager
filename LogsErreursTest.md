PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2>  npm run build

> bibliomanager2@0.1.0 build
> npm run build:server && npm run build:client

> bibliomanager2@0.1.0 build:server
> tsc -p tsconfig.json

> bibliomanager2@0.1.0 build:client
> vite build --config client/vite.config.ts

vite v7.1.5 building for production...
✓ 26 modules transformed.
../dist/client/index.html                  0.33 kB │ gzip:  0.24 kB
../dist/client/assets/index-CaaV6KYK.js  144.18 kB │ gzip: 46.41 kB
✓ built in 584ms
PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> node dist/index.js
node:internal/modules/esm/resolve:274
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\dist\server' imported from C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\dist\index.js
    at finalizeResolution (node:internal/modules/esm/resolve:274:11)
    at moduleResolve (node:internal/modules/esm/resolve:859:10)
    at defaultResolve (node:internal/modules/esm/resolve:983:11)
    at ModuleLoader.defaultResolve (node:internal/modules/esm/loader:783:12)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:707:25)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:690:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:307:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:183:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/dist/server'
}

Node.js v22.18.0
