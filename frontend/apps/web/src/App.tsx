import { Counter } from '@ci/common';
import { Counter as CounterThingo } from '@ci/thingo';

import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

import { useListUsers } from './services/use-list-users';

function App() {
  const { users, loading } = useListUsers();

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>

      <h1>Vite + React</h1>

      <div className="card">
        <h2>Current users:</h2>
        {!loading && users.map((user) => <div key={user.id}>{user.name}</div>)}
      </div>

      <div className="card">
        <h2>Yarn Workspaces Test</h2>
        <p>These counters should maintain separate state.</p>

        <Counter />
        <CounterThingo />
      </div>
    </>
  );
}

export default App;
