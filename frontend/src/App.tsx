import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import './App.css';

export default function App() {
  const { publicKey, connected } = useWallet();
  
  const [status, setStatus] = useState<any>(null);
  const [markets, setMarkets] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | boolean>(false);
  const [message, setMessage] = useState('');

  // Trading parameters
  const [marketIndex, setMarketIndex] = useState(0);  // 0=SOL, 1=BTC, 2=ETH
  const [direction, setDirection] = useState('long');
  const [size, setSize] = useState(0.01);  // Start small for testing

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 6000);
  };

  const loadMarkets = async () => {
    try {
      const res = await fetch('/drift/markets');
      const data = await res.json();
      setMarkets(data.perps || []);
    } catch {}
  };

  const loadData = async () => {
    try {
      const [statusRes, positionsRes] = await Promise.all([
        fetch('/drift/status'),
        fetch('/drift/positions')
      ]);
      
      setStatus(await statusRes.json());
      const posData = await positionsRes.json();
      setPositions(posData.perps || []);
    } catch (e: any) {
      showMessage('Check backend is running on port 3000');
    }
  };

  const initAccount = async () => {
    setLoading('init');
    try {
      const res = await fetch('/drift/init', { method: 'POST' });
      const data = await res.json();
      showMessage(data.already ? 'Account already exists' : 'Account created!');
      setTimeout(() => loadData(), 1500);
    } catch {
      showMessage('Failed to initialize');
    }
    setLoading(false);
  };

  // Open a new perpetual position
  // Requires: initialized account + sufficient collateral
  const openPosition = async () => {
    setLoading('open');
    showMessage('Sending transaction...');
    try {
      const res = await fetch(`/drift/open?marketIndex=${marketIndex}&dir=${direction}&size=${size}`, { method: 'POST' });
      const data = await res.json();
      
      if (data.signature) {
        showMessage(`Position opened! TX: ${data.signature.slice(0, 8)}...`);
        setTimeout(() => loadData(), 2000);
      } else if (data.message) {
        if (data.message.includes('InsufficientCollateral') || data.message.includes('Insufficient collateral')) {
          showMessage('Not enough collateral! Deposit first: npm run drift deposit-sol 2');
        } else {
          showMessage(`Failed: ${data.message}`);
        }
      } else {
        showMessage('Transaction failed');
      }
    } catch (e: any) {
      const errMsg = e.message || 'Unknown error';
      if (errMsg.includes('InsufficientCollateral')) {
        showMessage('Not enough collateral! Deposit first: npm run drift deposit-sol 2');
      } else {
        showMessage(`Error: ${errMsg.slice(0, 50)}`);
      }
    }
    setLoading(false);
  };

  const closePosition = async (idx: number) => {
    const closeKey = `close-${idx}`;
    setLoading(closeKey);
    showMessage('Closing position...');
    try {
      const res = await fetch(`/drift/close?marketIndex=${idx}`, { method: 'POST' });
      const data = await res.json();
      
      if (data.ok && data.signature) {
        showMessage(`Position closed! TX: ${data.signature.slice(0, 8)}...`);
        setTimeout(() => loadData(), 2000);
      } else if (data.reason) {
        showMessage(`Failed: ${data.reason}`);
      } else {
        showMessage('Failed to close position');
      }
    } catch (e: any) {
      showMessage(`Error: ${e.message || 'Unknown error'}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMarkets();
    loadData();
  }, []);

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div>
            <h1>Drift Protocol</h1>
            <p>Solana Devnet - Educational Demo</p>
          </div>
          <WalletMultiButton />
        </div>
        {connected && publicKey && (
          <div className="wallet-info">
            Connected: {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
          </div>
        )}
        <button onClick={loadData} className="refresh-btn">
          Refresh Data
        </button>
      </header>

      <main>
        {message && <div className="message">{message}</div>}

        <section className="card">
          <h2>Account Status</h2>
          {status ? (
            <div>
              <p><strong>Wallet:</strong> <code>{status.wallet?.slice(0, 8)}...</code></p>
              <p><strong>SOL Balance:</strong> {status.walletSol?.toFixed(4)} SOL</p>
              <p><strong>Status:</strong> <span className={status.accountExists ? 'ready' : 'warning'}>{status.accountExists ? 'Ready' : 'Not initialized'}</span></p>
              {!status.accountExists && (
                <button onClick={initAccount} disabled={loading === 'init'} className="btn-primary">
                  {loading === 'init' ? 'Initializing...' : 'Initialize Account'}
                </button>
              )}
              {status.accountExists && (
                <p className="warning-text">Note: Deposit SOL or USDC collateral before opening positions (CLI: `npm run drift deposit-sol 2`)</p>
              )}
            </div>
          ) : (
            <p className="loading">Loading...</p>
          )}
        </section>

        <section className="card">
          <h2>Active Positions</h2>
          {positions.length > 0 ? (
            <div className="positions-list">
              {positions.map((pos) => {
                const isClosing = loading === `close-${pos.marketIndex}`;
                return (
                  <div key={pos.marketIndex} className={`position ${isClosing ? 'closing' : ''}`}>
                    <div className="position-info">
                      <strong>{pos.marketSymbol}</strong>
                      <span className={pos.direction === 'LONG' ? 'badge long' : 'badge short'}>{pos.direction}</span>
                      {isClosing && <span className="badge closing-badge">CLOSING...</span>}
                      <span>Size: {pos.size.toFixed(4)}</span>
                      <span>Entry: ${pos.entryPrice.toFixed(2)}</span>
                    </div>
                    <button 
                      onClick={() => closePosition(pos.marketIndex)} 
                      disabled={isClosing}
                      className="btn-close"
                    >
                      {isClosing ? 'Closing...' : 'Close'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty">No active positions</p>
          )}
        </section>

        <section className="card">
          <h2>Open New Position</h2>
          <div className="form">
            <label>
              <strong>Market</strong>
              <select value={marketIndex} onChange={(e) => setMarketIndex(+e.target.value)}>
                {markets.map((m) => (
                  <option key={m.marketIndex} value={m.marketIndex}>{m.symbol}</option>
                ))}
              </select>
            </label>

            <label>
              <strong>Direction</strong>
              <div className="radio">
                <label><input type="radio" value="long" checked={direction === 'long'} onChange={(e) => setDirection(e.target.value)} /> Long</label>
                <label><input type="radio" value="short" checked={direction === 'short'} onChange={(e) => setDirection(e.target.value)} /> Short</label>
              </div>
            </label>

            <label>
              <strong>Size</strong>
              <input type="number" step="0.01" min="0.01" value={size} onChange={(e) => setSize(+e.target.value)} placeholder="0.01" />
            </label>

            <button onClick={openPosition} disabled={loading === 'open' || !status?.accountExists} className="btn-primary">
              {loading === 'open' ? 'Opening...' : 'Open Position'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
