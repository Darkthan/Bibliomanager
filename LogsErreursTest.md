PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> npm run lint

> bibliomanager@0.0.6 lint
> eslint .

C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\client\src\App.tsx
    26:10  warning  'status' is assigned a value but never used    @typescript-eslint/no-unused-vars
   206:18  warning  'printZpl' is defined but never used           @typescript-eslint/no-unused-vars
   283:18  warning  'printZebraLocal' is defined but never used    @typescript-eslint/no-unused-vars
   556:12  warning  'toggleRead' is defined but never used         @typescript-eslint/no-unused-vars
   560:9   warning  'stats' is assigned a value but never used     @typescript-eslint/no-unused-vars
   800:12  warning  'genUID' is defined but never used             @typescript-eslint/no-unused-vars
   859:18  warning  'printBookCard' is defined but never used      @typescript-eslint/no-unused-vars
   905:18  warning  'printEpcLabel' is defined but never used      @typescript-eslint/no-unused-vars
  1111:21  warning  'err' is defined but never used                @typescript-eslint/no-unused-vars
  1197:12  warning  'addBookDirect' is defined but never used      @typescript-eslint/no-unused-vars
  1221:18  warning  'addFromSuggestion' is defined but never used  @typescript-eslint/no-unused-vars

C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\client\tests\App.spec.tsx
  6:3  warning  Unused eslint-disable directive (no problems were reported from 'no-var')

C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\src\index.ts
  9:3  warning  Unused eslint-disable directive (no problems were reported from 'no-console')

C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\src\server.ts
  558:37  warning  '_editionKey' is defined but never used                                        @typescript-eslint/no-unused-vars
  669:16  warning  'e' is defined but never used                                                  @typescript-eslint/no-unused-vars
  694:9   warning  Unused eslint-disable directive (no problems were reported from 'no-console')

✖ 16 problems (0 errors, 16 warnings)
  0 errors and 3 warnings potentially fixable with the `--fix` option.
