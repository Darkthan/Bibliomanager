> bibliomanager@0.0.6 test
> vitest run

 RUN  v3.2.4 C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2

 ✓  0  tests/index.spec.ts (1 test) 3ms
 ✓  0  tests/server.spec.ts (2 tests) 26ms
 ❯  1  client/tests/App.spec.tsx (2 tests | 1 failed) 1085ms
   ✓ App > renders header and navigation 63ms
   × App > renders even if health check fails 1021ms
     → Found multiple elements with the text: /Bibliomanager/i

Here are the matching elements:

Ignored nodes: comments, script, style

<h1
  style="margin: 0px;"
>
  Bibliomanager
</h1>

Ignored nodes: comments, script, style

<h1
  style="margin: 0px;"
>
  Bibliomanager
</h1>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style

<body>
  <div>
    <main
      class="app-main"
      style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; display: grid; gap: 16px; max-width: 960px; margin: 0px auto;"
    >
      <header
        class="app-header"
        style="display: flex; align-items: center; justify-content: space-between;"
      >
        <div
          style="display: flex; align-items: center; gap: 10px;"
        >
          <button
            aria-expanded="false"
            aria-label="Menu"
            class="hamburger"
            style="display: none; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel);"
            type="button"
          >
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto;"
            />
          </button>
          <h1
            style="margin: 0px;"
          >
            Bibliomanager
          </h1>
        </div>
        <div
          style="display: flex; align-items: center; gap: 8px;"
        >
          <button
            aria-label="Paramètres"
            style="width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer;"
            title="Paramètres"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M19.4 12.98c.04-.32.06-.65.06-.98 0-.33-.02-.66-.06-.98l2.01-1.57a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.37.95a7.63 7.63 0 0 0-1.7-.98l-.36-2.52a.5.5 0 0 0-.5-.43h-3.8a.5.5 0 0 0-.5.43l-.36 2.52c-.6.24-1.17.56-1.7.98l-2.37-.95a.5.5 0 0 0-.6.22L2.47 6.8a.5.5 0 0 0 .12.64L4.6 9.01c-.04.32-.06.65-.06.99 0 .33.02.66.06.98l-2.01 1.57a.5.5 0 0 0-.12.64l1.9 3.29c.13.23.4.32.64.22l2.37-.95c.52.42 1.1.75 1.7.99l.36 2.52c.05.25.26.43.5.43h3.8c.24 0 .45-.18.5-.43l.36-2.52c.6-.24 1.17-.57 1.7-.99l2.37.95c.24.1.51 0 .64-.22l1.9-3.29a.5.5 0 0 0-.12-.64l-2.01-1.57Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
          <button
            style="padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); cursor: pointer;"
            type="button"
          >
            Se connecter
          </button>
        </div>
      </header>
      <section
        style="padding: 8px;"
      >
        <div
          style="display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr));"
        >
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📚
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Livres disponibles
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Consulter et prêter rapidement
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              ➕
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Ajouter un livre
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Saisie rapide avec ISBN/CB
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📄
            </div>
        ...

Ignored nodes: comments, script, style

<body>
  <div>
    <main
      class="app-main"
      style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; display: grid; gap: 16px; max-width: 960px; margin: 0px auto;"
    >
      <header
        class="app-header"
        style="display: flex; align-items: center; justify-content: space-between;"
      >
        <div
          style="display: flex; align-items: center; gap: 10px;"
        >
          <button
            aria-expanded="false"
            aria-label="Menu"
            class="hamburger"
            style="display: none; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel);"
            type="button"
          >
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto;"
            />
          </button>
          <h1
            style="margin: 0px;"
          >
            Bibliomanager
          </h1>
        </div>
        <div
          style="display: flex; align-items: center; gap: 8px;"
        >
          <button
            aria-label="Paramètres"
            style="width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer;"
            title="Paramètres"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M19.4 12.98c.04-.32.06-.65.06-.98 0-.33-.02-.66-.06-.98l2.01-1.57a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.37.95a7.63 7.63 0 0 0-1.7-.98l-.36-2.52a.5.5 0 0 0-.5-.43h-3.8a.5.5 0 0 0-.5.43l-.36 2.52c-.6.24-1.17.56-1.7.98l-2.37-.95a.5.5 0 0 0-.6.22L2.47 6.8a.5.5 0 0 0 .12.64L4.6 9.01c-.04.32-.06.65-.06.99 0 .33.02.66.06.98l-2.01 1.57a.5.5 0 0 0-.12.64l1.9 3.29c.13.23.4.32.64.22l2.37-.95c.52.42 1.1.75 1.7.99l.36 2.52c.05.25.26.43.5.43h3.8c.24 0 .45-.18.5-.43l.36-2.52c.6-.24 1.17-.57 1.7-.99l2.37.95c.24.1.51 0 .64-.22l1.9-3.29a.5.5 0 0 0-.12-.64l-2.01-1.57Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
          <button
            style="padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); cursor: pointer;"
            type="button"
          >
            Se connecter
          </button>
        </div>
      </header>
      <section
        style="padding: 8px;"
      >
        <div
          style="display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr));"
        >
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📚
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Livres disponibles
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Consulter et prêter rapidement
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              ➕
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Ajouter un livre
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Saisie rapide avec ISBN/CB
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📄
            </div>
        ...

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL   1  client/tests/App.spec.tsx > App > renders even if health check fails
TestingLibraryElementError: Found multiple elements with the text: /Bibliomanager/i

Here are the matching elements:

Ignored nodes: comments, script, style

<h1
  style="margin: 0px;"
>
  Bibliomanager
</h1>

Ignored nodes: comments, script, style

<h1
  style="margin: 0px;"
>
  Bibliomanager
</h1>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style

<body>
  <div>
    <main
      class="app-main"
      style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; display: grid; gap: 16px; max-width: 960px; margin: 0px auto;"
    >
      <header
        class="app-header"
        style="display: flex; align-items: center; justify-content: space-between;"
      >
        <div
          style="display: flex; align-items: center; gap: 10px;"
        >
          <button
            aria-expanded="false"
            aria-label="Menu"
            class="hamburger"
            style="display: none; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel);"
            type="button"
          >
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto;"
            />
          </button>
          <h1
            style="margin: 0px;"
          >
            Bibliomanager
          </h1>
        </div>
        <div
          style="display: flex; align-items: center; gap: 8px;"
        >
          <button
            aria-label="Paramètres"
            style="width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer;"
            title="Paramètres"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M19.4 12.98c.04-.32.06-.65.06-.98 0-.33-.02-.66-.06-.98l2.01-1.57a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.37.95a7.63 7.63 0 0 0-1.7-.98l-.36-2.52a.5.5 0 0 0-.5-.43h-3.8a.5.5 0 0 0-.5.43l-.36 2.52c-.6.24-1.17.56-1.7.98l-2.37-.95a.5.5 0 0 0-.6.22L2.47 6.8a.5.5 0 0 0 .12.64L4.6 9.01c-.04.32-.06.65-.06.99 0 .33.02.66.06.98l-2.01 1.57a.5.5 0 0 0-.12.64l1.9 3.29c.13.23.4.32.64.22l2.37-.95c.52.42 1.1.75 1.7.99l.36 2.52c.05.25.26.43.5.43h3.8c.24 0 .45-.18.5-.43l.36-2.52c.6-.24 1.17-.57 1.7-.99l2.37.95c.24.1.51 0 .64-.22l1.9-3.29a.5.5 0 0 0-.12-.64l-2.01-1.57Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
          <button
            style="padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); cursor: pointer;"
            type="button"
          >
            Se connecter
          </button>
        </div>
      </header>
      <section
        style="padding: 8px;"
      >
        <div
          style="display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr));"
        >
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📚
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Livres disponibles
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Consulter et prêter rapidement
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              ➕
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Ajouter un livre
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Saisie rapide avec ISBN/CB
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📄
            </div>
        ...

Ignored nodes: comments, script, style

<body>
  <div>
    <main
      class="app-main"
      style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; display: grid; gap: 16px; max-width: 960px; margin: 0px auto;"
    >
      <header
        class="app-header"
        style="display: flex; align-items: center; justify-content: space-between;"
      >
        <div
          style="display: flex; align-items: center; gap: 10px;"
        >
          <button
            aria-expanded="false"
            aria-label="Menu"
            class="hamburger"
            style="display: none; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel);"
            type="button"
          >
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto 4px;"
            />
            <span
              style="display: block; width: 20px; height: 2px; background: var(--text); margin: 0px auto;"
            />
          </button>
          <h1
            style="margin: 0px;"
          >
            Bibliomanager
          </h1>
        </div>
        <div
          style="display: flex; align-items: center; gap: 8px;"
        >
          <button
            aria-label="Paramètres"
            style="width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer;"
            title="Paramètres"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M19.4 12.98c.04-.32.06-.65.06-.98 0-.33-.02-.66-.06-.98l2.01-1.57a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.37.95a7.63 7.63 0 0 0-1.7-.98l-.36-2.52a.5.5 0 0 0-.5-.43h-3.8a.5.5 0 0 0-.5.43l-.36 2.52c-.6.24-1.17.56-1.7.98l-2.37-.95a.5.5 0 0 0-.6.22L2.47 6.8a.5.5 0 0 0 .12.64L4.6 9.01c-.04.32-.06.65-.06.99 0 .33.02.66.06.98l-2.01 1.57a.5.5 0 0 0-.12.64l1.9 3.29c.13.23.4.32.64.22l2.37-.95c.52.42 1.1.75 1.7.99l.36 2.52c.05.25.26.43.5.43h3.8c.24 0 .45-.18.5-.43l.36-2.52c.6-.24 1.17-.57 1.7-.99l2.37.95c.24.1.51 0 .64-.22l1.9-3.29a.5.5 0 0 0-.12-.64l-2.01-1.57Z"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
          <button
            style="padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); cursor: pointer;"
            type="button"
          >
            Se connecter
          </button>
        </div>
      </header>
      <section
        style="padding: 8px;"
      >
        <div
          style="display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr));"
        >
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📚
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Livres disponibles
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Consulter et prêter rapidement
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              ➕
            </div>
            <div>
              <div
                style="font-weight: 700; margin-bottom: 6px;"
              >
                Ajouter un livre
              </div>
              <div
                style="color: var(--muted); font-size: 14px;"
              >
                Saisie rapide avec ISBN/CB
              </div>
            </div>
          </button>
          <button
            style="display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 20px; border-radius: 16px; border: 2px solid var(--border); background: var(--panel); min-height: 140px; text-align: left; font-size: 18px; cursor: pointer;"
          >
            <div
              style="font-size: 28px;"
            >
              📄
            </div>
        ...
 ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ node_modules/@testing-library/dom/dist/query-helpers.js:86:33
 ❯ client/tests/App.spec.tsx:29:25
     27|     vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
     28|     render(<App />);
     29|     expect(await screen.findByText(/Bibliomanager/i)).toBeInTheDocument();
       |                         ^
     30|   });
     31| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 4 passed (5)
   Start at  09:57:13
   Duration  2.57s (transform 240ms, setup 99ms, collect 529ms, tests 1.11s, environment 666ms, prepare 319ms)
