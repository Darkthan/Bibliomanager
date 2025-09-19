error during build:
[vite:esbuild] Transform failed with 1 error:
C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:168:38: ERROR: Expected ")" but found "agent"
file: C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:168:38

Expected ")" but found "agent"
166 |        if (!r.ok) { r = await fetch('http://127.0.0.1:9110/print', payload); }
167 |        if (!r.ok) throw new Error('Agent répond en erreur');
168 |        alert('Étiquette envoyée à l'agent local.');
    |                                        ^
169 |      } catch (e: any) {
170 |        alert('Erreur agent local: ' + (e?.message || 'inconnue'));

    at failureErrorWithLog (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:1467:15)
    at C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:736:50
    at responseCallbacks.<computed> (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:603:9)
    at handleIncomingPacket (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:658:12)
    at Socket.readFromStdout (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:581:7)
    at Socket.emit (node:events:518:28)
    at addChunk (node:internal/streams/readable:561:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
    at Readable.push (node:internal/streams/readable:392:5)
    at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
