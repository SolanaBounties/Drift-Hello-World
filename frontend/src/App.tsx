import { useEffect, useState } from 'react';

export default function App() {
  const [rows, setRows] = useState<any[]>([]);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    // using Vite proxy (/health proxied to 3000) OR direct if you prefer
    fetch('/health')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => setOk(true))
      .catch(() => setOk(false));

    fetch('/api/examples')
      .then(r => r.json())
      .then(setRows)
      .catch(console.error);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Drift Hello World</h1>
      <p>Backend status: {ok ? '✅' : '❌'} &nbsp;
        <a href="http://localhost:3000" target="_blank" rel="noreferrer">
          open backend
        </a>
      </p>
      <button onClick={() => fetch('/api/seed').then(() => location.reload())}>
        Seed row
      </button>
      <pre>{JSON.stringify(rows, null, 2)}</pre>
    </div>
  );
}
