/**
 * Self-contained GraphiQL IDE (https://github.com/graphql/graphiql) served at
 * `GET /graphiql` (reachable from the browser as `/api/graphiql`, the reverse
 * proxy strips the `/api` prefix).
 *
 * The markup is inlined as a string rather than shipped as a static `.html`
 * asset on purpose: the API build is `tsc` only (no asset-copy step) and the
 * Docker image ships just `dist`, so a sibling `.html` would 404 in production.
 * A `.ts` module compiles into `dist` like any other file.
 *
 * Auth: the CI GraphQL API accepts an `x-api-key` header (see ApiKeyStrategy /
 * JwtOrApiKeyAuthGuard). The user pastes a key created under
 * Settings → API Keys; it is persisted in localStorage and attached to every
 * request. A `Bearer` token from `accessToken` is also sent when present so an
 * existing session keeps working.
 */
const GRAPHIQL_VERSION = '2.4.5';

export const GRAPHIQL_HTML = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GraphiQL · Companion Intelligence</title>
    <link rel="stylesheet" href="https://unpkg.com/graphiql@${GRAPHIQL_VERSION}/graphiql.min.css" />
    <style>
      :root {
        color-scheme: dark;
      }
      html,
      body {
        margin: 0;
        height: 100%;
        background: #0b0e14;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      #root {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }
      #apiKeyBar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: #11151f;
        border-bottom: 1px solid #262d3b;
        color: #c7d0e0;
        font-size: 13px;
        flex: 0 0 auto;
      }
      #apiKeyBar strong {
        color: #e8edf6;
        font-weight: 600;
        margin-right: 4px;
      }
      #apiKeyBar input {
        flex: 1 1 auto;
        min-width: 120px;
        max-width: 480px;
        padding: 6px 10px;
        border: 1px solid #333c4d;
        border-radius: 6px;
        background: #0b0e14;
        color: #e8edf6;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 12px;
      }
      #apiKeyBar input:focus {
        outline: none;
        border-color: #4f7cff;
      }
      #apiKeyBar button {
        padding: 6px 12px;
        border: 1px solid #333c4d;
        border-radius: 6px;
        background: #1b2130;
        color: #e8edf6;
        font-size: 12px;
        cursor: pointer;
      }
      #apiKeyBar button:hover {
        background: #232b3d;
      }
      #apiKeyBar .status {
        white-space: nowrap;
        font-size: 12px;
      }
      #apiKeyBar .status.ok {
        color: #5ad19a;
      }
      #apiKeyBar .status.off {
        color: #e0a03c;
      }
      #apiKeyBar a {
        color: #7fa3ff;
        text-decoration: none;
        white-space: nowrap;
      }
      #apiKeyBar a:hover {
        text-decoration: underline;
      }
      #graphiql {
        flex: 1 1 auto;
        min-height: 0;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div id="apiKeyBar">
        <strong>API key</strong>
        <input
          id="apiKeyInput"
          type="password"
          placeholder="Paste an x-api-key…"
          autocomplete="off"
          spellcheck="false"
        />
        <button id="apiKeySave" type="button">Save</button>
        <button id="apiKeyClear" type="button">Clear</button>
        <span id="apiKeyStatus" class="status off">no key set</span>
        <a href="/settings/api-keys" target="_blank" rel="noopener noreferrer">Manage keys →</a>
      </div>
      <div id="graphiql">Loading GraphiQL…</div>
    </div>

    <script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/graphiql@${GRAPHIQL_VERSION}/graphiql.min.js"></script>
    <script>
      (function () {
        var STORAGE_KEY = 'ci-graphiql-api-key';

        var input = document.getElementById('apiKeyInput');
        var status = document.getElementById('apiKeyStatus');

        function getApiKey() {
          return localStorage.getItem(STORAGE_KEY) || '';
        }

        function renderStatus() {
          var key = getApiKey();
          if (key) {
            status.textContent = 'key active (' + key.slice(0, 6) + '…)';
            status.className = 'status ok';
          } else {
            status.textContent = 'no key set';
            status.className = 'status off';
          }
        }

        input.value = getApiKey();
        renderStatus();

        document.getElementById('apiKeySave').addEventListener('click', function () {
          var value = input.value.trim();
          if (value) {
            localStorage.setItem(STORAGE_KEY, value);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
          renderStatus();
        });

        document.getElementById('apiKeyClear').addEventListener('click', function () {
          localStorage.removeItem(STORAGE_KEY);
          input.value = '';
          renderStatus();
        });

        // Read auth headers fresh on every request so saving a key takes effect
        // without reloading the page.
        var fetcher = function (graphQLParams) {
          var headers = { 'Content-Type': 'application/json' };
          var apiKey = getApiKey();
          if (apiKey) {
            headers['x-api-key'] = apiKey;
          }
          var bearer = localStorage.getItem('accessToken');
          if (bearer) {
            headers['Authorization'] = 'Bearer ' + bearer;
          }
          return fetch('/api/graphql', {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify(graphQLParams),
          }).then(function (res) {
            return res.json();
          });
        };

        if (!window.GraphiQL) {
          document.getElementById('graphiql').textContent =
            'Failed to load GraphiQL from the CDN.';
          return;
        }

        var root = ReactDOM.createRoot(document.getElementById('graphiql'));
        root.render(
          React.createElement(window.GraphiQL, {
            fetcher: fetcher,
            defaultEditorToolsVisibility: true,
          }),
        );
      })();
    </script>
  </body>
</html>`;
