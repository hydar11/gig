import React, { useState, useEffect } from 'react';
import { 
  AbstractWalletProvider, 
  useLoginWithAbstract, 
  useAbstractClient, 
  useGlobalWalletSignerAccount,
  useCreateSession
} from '@abstract-foundation/agw-react';
import { useAccount } from 'wagmi';
import { abstract } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseEther, toFunctionSelector } from 'viem';

// AGW Provider Component
const AGWProvider = ({ children }) => {
  return (
    <AbstractWalletProvider chain={abstract}>
      {children}
    </AbstractWalletProvider>
  );
};

// Chart Component using LightweightCharts
const Chart = ({ itemId, timeframe, chartType, currency, ethToUsdRate }) => {
  const [chart, setChart] = useState(null);
  const [candlestickSeries, setCandlestickSeries] = useState(null);
  const [lineSeries, setLineSeries] = useState(null);
  const [volumeSeries, setVolumeSeries] = useState(null);

  useEffect(() => {
    if (typeof window.LightweightCharts !== 'undefined') {
      initChart();
    }
    return () => {
      if (chart) chart.remove();
    };
  }, []);

  useEffect(() => {
    if (itemId && chart) {
      loadChartData(itemId);
    }
  }, [itemId, timeframe, chart]);

  const initChart = () => {
    const chartContainer = document.getElementById('chart');
    if (!chartContainer || !window.LightweightCharts) return;

    const newChart = window.LightweightCharts.createChart(chartContainer, {
      autoSize: true,
      height: 400,
      layout: { background: { color: 'oklch(14.1% .005 285.823)' }, textColor: '#ffffff', fontFamily: 'Silkscreen, Courier New, monospace' },
      grid: { vertLines: { color: 'rgba(255, 255, 255, 0.1)' }, horzLines: { color: 'rgba(255, 255, 255, 0.1)' } },
      timeScale: { 
        borderColor: 'rgba(255, 255, 255, 0.1)', 
        timeVisible: true, 
        rightOffset: 0, 
        fixRightEdge: false, 
        fixLeftEdge: false,
        barSpacing: 6,
        lockVisibleTimeRangeOnResize: true
      },
      rightPriceScale: { 
        visible: true, 
        borderVisible: true, 
        borderColor: 'rgba(255, 255, 255, 0.3)', 
        scaleMargins: { top: 0.1, bottom: 0.25 }, 
        ticksVisible: true, 
        entireTextOnly: false, 
        minimumWidth: 80, 
        alignLabels: true, 
        autoScale: true 
      },
      leftPriceScale: { visible: false },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
      localization: {
        priceFormatter: (price) => {
          if (currency === 'USD' && ethToUsdRate) {
            const usdPrice = price * ethToUsdRate;
            return usdPrice < 0.01 ? usdPrice.toFixed(6) : usdPrice < 1 ? usdPrice.toFixed(4) : usdPrice.toFixed(2);
          }
          if (price < 0.000001) return price.toFixed(10).replace(/\.?0+$/, '');
          if (price < 0.00001) return price.toFixed(8).replace(/\.?0+$/, '');
          if (price < 0.0001) return price.toFixed(7).replace(/\.?0+$/, '');
          if (price < 0.001) return price.toFixed(6).replace(/\.?0+$/, '');
          if (price < 0.01) return price.toFixed(5).replace(/\.?0+$/, '');
          if (price < 0.1) return price.toFixed(4).replace(/\.?0+$/, '');
          return price.toFixed(3).replace(/\.?0+$/, '');
        }
      }
    });
    
    const newCandlestickSeries = newChart.addCandlestickSeries({ 
      upColor: '#4ade80', 
      downColor: '#ef4444', 
      borderVisible: false, 
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 }
    });
    
    const newLineSeries = newChart.addLineSeries({ 
      color: '#f59e0b', 
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 }
    });
    
    const newVolumeSeries = newChart.addHistogramSeries({ 
      color: '#f59e0b', 
      priceFormat: { type: 'volume' }, 
      priceScaleId: '' 
    });
    
    newVolumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.9, bottom: 0 } });

    setChart(newChart);
    setCandlestickSeries(newCandlestickSeries);
    setLineSeries(newLineSeries);
    setVolumeSeries(newVolumeSeries);
  };

  const loadChartData = async (itemId) => {
    try {
      const response = await fetch(`/api/chart-data/${itemId}?timeframe=${timeframe}`);
      if (response.ok) {
        const data = await response.json();
        updateChart(data);
      }
    } catch (error) {
      console.error('Failed to load chart data:', error);
    }
  };

  const updateChart = (data) => {
    if (!candlestickSeries || !lineSeries || !data.length) return;

    const formattedData = data.map(item => ({
      time: Math.floor(new Date(item.timestamp).getTime() / 1000),
      open: currency === 'USD' && ethToUsdRate ? item.price * ethToUsdRate : item.price,
      high: currency === 'USD' && ethToUsdRate ? item.price * ethToUsdRate * 1.02 : item.price * 1.02,
      low: currency === 'USD' && ethToUsdRate ? item.price * ethToUsdRate * 0.98 : item.price * 0.98,
      close: currency === 'USD' && ethToUsdRate ? item.price * ethToUsdRate : item.price,
      value: currency === 'USD' && ethToUsdRate ? item.price * ethToUsdRate : item.price
    }));

    candlestickSeries.setData(formattedData);
    lineSeries.setData(formattedData.map(d => ({ time: d.time, value: d.close })));
    
    // Update visibility based on chart type
    candlestickSeries.applyOptions({ visible: chartType === 'candlestick' });
    lineSeries.applyOptions({ visible: chartType === 'line' });
    
    setTimeout(() => {
      chart.timeScale().fitContent();
    }, 100);
  };

  return <div id="chart" style={{ width: '100%', height: '400px' }}></div>;
};

// Main Trading Dashboard Component
const TradingDashboard = () => {
  // AGW Hooks
  const { login, logout } = useLoginWithAbstract();
  const { data: abstractClient } = useAbstractClient();
  const { data: globalWalletAccount } = useGlobalWalletSignerAccount();
  const { address, isConnected } = useAccount();
  const { createSessionAsync } = useCreateSession();

  // State Management
  const [sessionKey, setSessionKey] = useState(null);
  const [sessionExpiry, setSessionExpiry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  // Data State - EXACT same as original
  const [marketData, setMarketData] = useState([]);
  const [itemDetails, setItemDetails] = useState({});
  const [currentItem, setCurrentItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [ethToUsdRate, setEthToUsdRate] = useState(3500);
  const [totalMarketVolume24h, setTotalMarketVolume24h] = useState(0);
  
  // Chart State
  const [timeframe, setTimeframe] = useState('1d');
  const [chartType, setChartType] = useState('line');
  const [currency, setCurrency] = useState('USD');
  
  // Trading State
  const [activeTab, setActiveTab] = useState('buy');
  const [buyAmount, setBuyAmount] = useState(1);
  const [sellAmount, setSellAmount] = useState(1);
  const [sellPrice, setSellPrice] = useState(0.001);
  
  // Recent Trades & Order Book
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderBook, setOrderBook] = useState([]);
  const [allRecentTrades, setAllRecentTrades] = useState([]);
  const [tickerIndex, setTickerIndex] = useState(0);

  // Stats
  const [stats, setStats] = useState({
    totalVolume: '-',
    itemsSold: '-',
    priceRange: '-',
    supply: '-',
    marketVolume: '-'
  });

  // Load data on mount - EXACT same as original
  useEffect(() => {
    loadItemDetails().then(() => {
      loadMarkets();
      initTicker();
    });
    fetchEthToUsdRate();
    const refreshInterval = setInterval(refreshData, 30000);
    return () => clearInterval(refreshInterval);
  }, []);

  // Auto-select first item when markets load
  useEffect(() => {
    if (marketData.length > 0 && !currentItem) {
      setCurrentItem(marketData[0]);
    }
  }, [marketData, currentItem]);

  // Load item data when item changes
  useEffect(() => {
    if (currentItem) {
      loadItemStats(currentItem);
      loadRecentTrades(currentItem);
      loadOrderBook(currentItem);
    }
  }, [currentItem]);

  // Ticker update
  useEffect(() => {
    const tickerInterval = setInterval(updateTicker, 5000);
    const loadInterval = setInterval(loadRecentTradesForTicker, 120000);
    return () => {
      clearInterval(tickerInterval);
      clearInterval(loadInterval);
    };
  }, [allRecentTrades, tickerIndex]);

  // Data Loading Functions - EXACT same as original
  const loadItemDetails = async () => {
    try {
      const response = await fetch('/api/item-details');
      const details = await response.json();
      setItemDetails(details);
      return details;
    } catch (error) {
      console.error('Failed to load item details:', error);
      return {};
    }
  };

  const loadMarkets = async () => {
    try {
      const response = await fetch('/api/items');
      const items = await response.json();
      setMarketData(items);
    } catch (error) {
      console.error('Failed to load markets:', error);
    }
  };

  const loadItemStats = async (itemId) => {
    try {
      const response = await fetch(`/api/stats/${itemId}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load item stats:', error);
    }
  };

  const loadRecentTrades = async (itemId) => {
    try {
      const response = await fetch(`/api/trades/${itemId}`);
      if (response.ok) {
        const data = await response.json();
        setRecentTrades(data);
      }
    } catch (error) {
      console.error('Failed to load recent trades:', error);
      setRecentTrades([]);
    }
  };

  const loadOrderBook = async (itemId) => {
    try {
      const response = await fetch(`/api/orderbook/${itemId}`);
      if (response.ok) {
        const data = await response.json();
        setOrderBook(data.asks || []);
      }
    } catch (error) {
      console.error('Failed to load order book:', error);
      setOrderBook([]);
    }
  };

  const loadRecentTradesForTicker = async () => {
    try {
      const items = Object.keys(itemDetails);
      if (!items.length) return;
      
      const allTrades = [];
      const batchSize = 5;
      
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchPromises = batch.map(async (itemId) => {
          try {
            const trades = await fetch(`/api/trades/${itemId}?limit=3`).then(res => res.json());
            if (trades && trades.length) {
              trades.forEach(trade => {
                const itemInfo = getItemInfo(itemId);
                allTrades.push({
                  ...trade,
                  itemId: itemId,
                  itemName: itemInfo.name,
                  itemIcon: itemInfo.image || itemInfo.icon,
                  ethValue: trade.ethSpent,
                  amount: trade.amount,
                  timestamp: trade.timestamp
                });
              });
            }
          } catch (error) {
            console.error(`Failed to load trades for ${itemId}:`, error);
          }
        });
        
        await Promise.all(batchPromises);
      }
      
      setAllRecentTrades(allTrades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 40));
    } catch (error) {
      console.error('Failed to load recent trades for ticker:', error);
    }
  };

  const fetchEthToUsdRate = async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      setEthToUsdRate(data.ethereum.usd);
    } catch (error) {
      console.error('Could not fetch ETH to USD rate:', error);
      setEthToUsdRate(3500);
    }
  };

  const refreshData = () => {
    if (currentItem) {
      loadItemStats(currentItem);
      loadRecentTrades(currentItem);
      loadOrderBook(currentItem);
    }
  };

  const initTicker = async () => {
    await loadRecentTradesForTicker();
    updateTicker();
  };

  const updateTicker = () => {
    if (!allRecentTrades.length) return;
    const tickerContent = document.getElementById('ticker-content');
    if (!tickerContent) return;
    
    const trade = allRecentTrades[tickerIndex];
    const formatUsdPrice = (ethPrice) => {
      if (!ethToUsdRate) return '0.00';
      const usd = ethPrice * ethToUsdRate;
      return usd < 0.0001 ? usd.toFixed(6) : usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2);
    };
    
    tickerContent.innerHTML = `<img src="${trade.itemIcon || ''}" class="ticker-icon" alt="${trade.itemName}" /><span class="text-success">BOUGHT</span><span> ${trade.amount} ${trade.itemName} </span><span class="muted">FOR $${formatUsdPrice(trade.ethValue)}</span>`;
    setTickerIndex((tickerIndex + 1) % allRecentTrades.length);
  };

  // Utility Functions - EXACT same as original
  const getItemInfo = (itemId) => {
    return itemDetails[itemId] ? {
      name: itemDetails[itemId].name || `Item ${itemId}`,
      image: itemDetails[itemId].image || itemDetails[itemId].icon,
      icon: itemDetails[itemId].icon,
      type: itemDetails[itemId].type
    } : {
      name: `Item ${itemId}`,
      image: null,
      icon: null,
      type: null
    };
  };

  const getTypes = () => {
    return [...new Set(Object.values(itemDetails).map(item => item.type).filter(type => type?.trim()))].sort();
  };

  const filterMarkets = () => {
    return marketData.filter(itemId => {
      const itemInfo = getItemInfo(itemId);
      const matchesName = !searchTerm || itemInfo.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = !selectedType || itemInfo.type === selectedType;
      return matchesName && matchesType;
    });
  };

  // AGW Functions
  const handleConnect = async () => {
    setLoading(true);
    try {
      await login();
      setMessage('🎉 AGW Connected Successfully!');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      console.error('AGW connection failed:', error);
      setMessage('Connection failed: ' + error.message);
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await logout();
      setSessionKey(null);
      setSessionExpiry(null);
      setMessage('AGW Disconnected Successfully');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage('Disconnect failed: ' + error.message);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const createSessionKey = async () => {
    if (!isConnected || !abstractClient) {
      setMessage('Please connect AGW first');
      setTimeout(() => setMessage(''), 5000);
      return;
    }

    setLoading(true);
    try {
      const newSessionPrivateKey = generatePrivateKey();
      const sessionSigner = privateKeyToAccount(newSessionPrivateKey);
      const expiryTime = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
      
      const { session, transactionHash } = await createSessionAsync({
        session: {
          signer: sessionSigner.address,
          expiresAt: expiryTime,
          feeLimit: {
            limitType: 1,
            limit: parseEther("1"),
            period: BigInt(0),
          },
          callPolicies: [{
            target: '0x807be43cd840144819ea8d05c19f4e5530d38bf1',
            selector: toFunctionSelector("bulkBuy(uint256[],uint256[])"),
          }]
        }
      });

      setSessionKey(sessionSigner.address);
      setSessionExpiry(Number(expiryTime));
      setMessage(`✅ Session key created successfully! TX: ${transactionHash ? transactionHash.slice(0, 10) + '...' : 'N/A'}`);
      setTimeout(() => setMessage(''), 8000);
      
    } catch (error) {
      console.error('Session creation failed:', error);
      setMessage('Session creation failed: ' + error.message);
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const filteredMarkets = filterMarkets();

  return (
    <div className="container">
      {/* Header - EXACT same */}
      <div className="header">
        <h1>Trading Dashboard</h1>
        <div className="header-nav">
          <a href="#" className="nav-tab">global stat</a>
          {!isConnected ? (
            <button className="nav-tab" onClick={handleConnect} disabled={loading}>
              {loading ? 'Connecting...' : '🌟 Connect AGW'}
            </button>
          ) : (
            <button className="nav-tab" onClick={handleDisconnect}>
              ✅ Connected {address?.slice(0, 6)}...{address?.slice(-4)}
            </button>
          )}
        </div>
      </div>

      {/* Message Display */}
      {message && (
        <div style={{ 
          background: 'linear-gradient(135deg, var(--success), var(--card))',
          padding: 'calc(var(--s) * 2)',
          borderRadius: 'var(--r)',
          marginBottom: 'calc(var(--s) * 3)',
          border: '1px solid var(--border)',
          color: 'var(--primary-fg)',
          fontWeight: '700',
          fontSize: '0.8rem'
        }}>
          {message}
        </div>
      )}

      {/* Live Trade Ticker - EXACT same */}
      <div id="biggest-trade-ticker">
        <div className="live-indicator">
          <div className="live-dot"></div>
          <span>LIVE</span>
        </div>
        <span id="ticker-content">Loading biggest trades...</span>
      </div>

      {/* Stats Section - EXACT same */}
      <div className="stats-section">
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-label">24h Item Volume</div>
            <div className="stat-value-container">
              <div className="stat-value">{stats.totalVolume || '-'}</div>
              <div className="stat-change"></div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-label">24h Item Sold</div>
            <div className="stat-value-container">
              <div className="stat-value">{stats.itemsSold || '-'}</div>
              <div className="stat-change"></div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <div className="stat-label">Price Range</div>
            <div className="stat-value-container">
              <div className="stat-value">{stats.priceRange || '-'}</div>
              <div className="stat-change"></div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-label">Supply</div>
            <div className="stat-value-container">
              <div className="stat-value">{stats.supply || '-'}</div>
              <div className="stat-change"></div>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-label">24h Total Market Volume</div>
            <div className="stat-value-container">
              <div className="stat-value">{stats.marketVolume || '-'}</div>
              <div className="stat-change"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Layout - EXACT same */}
      <div className="trading-layout">
        {/* Left Panel - Market List */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Markets</div>
            <div className="custom-dropdown">
              <div 
                className={`type-selector ${dropdownOpen ? 'open' : ''}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <span className="selected-text">{selectedType || 'All Types'}</span>
                <span className="dropdown-arrow">▼</span>
              </div>
              {dropdownOpen && (
                <div className="dropdown-menu" style={{ display: 'block' }}>
                  <div 
                    className={`dropdown-item ${!selectedType ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedType('');
                      setDropdownOpen(false);
                    }}
                  >
                    All Types
                  </div>
                  {getTypes().map(type => (
                    <div 
                      key={type}
                      className={`dropdown-item ${selectedType === type ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedType(type);
                        setDropdownOpen(false);
                      }}
                    >
                      {type}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <input
            type="text"
            className="market-search"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="market-list">
            {filteredMarkets.map(itemId => {
              const itemInfo = getItemInfo(itemId);
              const isActive = currentItem === itemId;
              
              return (
                <div
                  key={itemId}
                  className={`market-item ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentItem(itemId)}
                >
                  <div className="market-item-content">
                    <div 
                      className="market-item-icon"
                      style={{ backgroundImage: itemInfo.icon ? `url('${itemInfo.icon}')` : 'none' }}
                    ></div>
                    <div className="market-item-name">{itemInfo.name}</div>
                  </div>
                  <div className="market-item-details">
                    <span style={{ fontSize: '0.55rem', color: 'var(--muted-fg)' }}>Vol: 0</span>
                    <span className="market-change neutral">0%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Middle Panel - Chart and Trades */}
        <div className="panel">
          <div className="panel-header">
            <div className="chart-title-container">
              <div 
                className="chart-item-icon"
                style={{ 
                  backgroundImage: currentItem && getItemInfo(currentItem).icon ? 
                    `url('${getItemInfo(currentItem).icon}')` : 'none' 
                }}
              ></div>
              <div className="panel-title">
                {currentItem ? getItemInfo(currentItem).name : 'Price Chart'}
              </div>
            </div>
            <div className="chart-header-controls">
              <div className="chart-left-controls">
                <div className="timeframe-controls">
                  <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                    <option value="1h">1H</option>
                    <option value="4h">4H</option>
                    <option value="1d">1D</option>
                  </select>
                </div>
                <div className="currency-controls">
                  <div className="chart-controls">
                    <button 
                      className={`chart-type-btn ${currency === 'ETH' ? 'active' : ''}`}
                      onClick={() => setCurrency('ETH')}
                    >
                      ETH
                    </button>
                    <button 
                      className={`chart-type-btn ${currency === 'USD' ? 'active' : ''}`}
                      onClick={() => setCurrency('USD')}
                    >
                      USD
                    </button>
                  </div>
                </div>
              </div>
              <div className="chart-controls">
                <button 
                  className={`chart-type-btn ${chartType === 'candlestick' ? 'active' : ''}`}
                  onClick={() => setChartType('candlestick')}
                >
                  Candles
                </button>
                <button 
                  className={`chart-type-btn ${chartType === 'line' ? 'active' : ''}`}
                  onClick={() => setChartType('line')}
                >
                  Line
                </button>
                <button className="refresh-btn" onClick={refreshData} title="Refresh Chart">
                  ↻
                </button>
              </div>
            </div>
          </div>
          
          <Chart 
            itemId={currentItem} 
            timeframe={timeframe} 
            chartType={chartType} 
            currency={currency} 
            ethToUsdRate={ethToUsdRate} 
          />
          
          <div className="panel-header" style={{ marginTop: 'calc(var(--s) * 3)', marginBottom: 'calc(var(--s) * 2)' }}>
            <div className="panel-title">Recent Trades</div>
          </div>
          
          <div className="chart-trades">
            <table className="last-trades-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th style={{ textAlign: 'center' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'center' }}>Buyer</th>
                  <th style={{ textAlign: 'center' }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.slice(0, 20).map((trade, index) => (
                  <tr key={index}>
                    <td className="trade-time">
                      {new Date(trade.timestamp).toLocaleString([], {
                        month: '2-digit', day: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="trade-amount" style={{ textAlign: 'center' }}>{trade.amount}</td>
                    <td className="trade-price">{trade.price?.toFixed(6) || '-'}</td>
                    <td className="trade-price">{trade.ethSpent?.toFixed(6) || '-'}</td>
                    <td className="trade-buyer" style={{ textAlign: 'center' }}>
                      {trade.buyer ? `${trade.buyer.slice(0, 6)}...${trade.buyer.slice(-4)}` : '-'}
                    </td>
                    <td className="trade-hash" style={{ textAlign: 'center' }}>
                      {trade.tx ? (
                        <a href={`https://abscan.org/tx/${trade.tx}`} target="_blank" rel="noopener">
                          {trade.tx.slice(0, 6)}...{trade.tx.slice(-4)}
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Panel - Trading and Order Book */}
        <div className="panel">
          <div className="trading-section">
            <div className="trading-tabs">
              <div 
                className={`trading-tab ${activeTab === 'buy' ? 'active' : ''}`}
                onClick={() => setActiveTab('buy')}
              >
                Buy
              </div>
              <div 
                className={`trading-tab ${activeTab === 'sell' ? 'active' : ''}`}
                onClick={() => setActiveTab('sell')}
              >
                Sell
              </div>
            </div>
            <div className="trading-content">
              {activeTab === 'buy' ? (
                <div className="trading-form">
                  <div className="form-section">
                    <div className="form-group">
                      <label>Amount to Buy</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="1"
                        min="1"
                        max="3000"
                        value={buyAmount}
                        onChange={(e) => setBuyAmount(parseInt(e.target.value) || 1)}
                      />
                      <div>
                        <input
                          type="range"
                          className="range-slider"
                          min="1"
                          max="3000"
                          value={buyAmount}
                          onChange={(e) => setBuyAmount(parseInt(e.target.value))}
                        />
                        <div className="range-limits">
                          <span>1</span>
                          <span>3000</span>
                        </div>
                      </div>
                    </div>
                    <div className="price-info">
                      <div className="price-info-row">
                        <span>Item:</span>
                        <span>{currentItem ? getItemInfo(currentItem).name : 'Select item'}</span>
                      </div>
                      <div className="price-info-row price-info-total">
                        <span>Total Cost:</span>
                        <span>-</span>
                      </div>
                    </div>
                  </div>
                  <button className="trade-button buy-button">Buy Items</button>
                </div>
              ) : (
                <div className="trading-form">
                  <div className="form-section">
                    <div className="form-group">
                      <label>Price per Item</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="0.001"
                        step="0.000001"
                        min="0"
                        value={sellPrice}
                        onChange={(e) => setSellPrice(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Amount to Sell</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="1"
                        min="1"
                        max="3000"
                        value={sellAmount}
                        onChange={(e) => setSellAmount(parseInt(e.target.value) || 1)}
                      />
                      <div>
                        <input
                          type="range"
                          className="range-slider"
                          min="1"
                          max="3000"
                          value={sellAmount}
                          onChange={(e) => setSellAmount(parseInt(e.target.value))}
                        />
                        <div className="range-limits">
                          <span>1</span>
                          <span>3000</span>
                        </div>
                      </div>
                    </div>
                    <div className="price-info">
                      <div className="price-info-row">
                        <span>Item:</span>
                        <span>{currentItem ? getItemInfo(currentItem).name : 'Select item'}</span>
                      </div>
                      <div className="price-info-row">
                        <span>Your Balance:</span>
                        <span>-</span>
                      </div>
                      <div className="price-info-row price-info-total">
                        <span>Total Receive:</span>
                        <span>{(sellPrice * sellAmount).toFixed(6)} ETH</span>
                      </div>
                    </div>
                  </div>
                  <button className="trade-button sell-button">List for Sale</button>
                </div>
              )}
            </div>
          </div>
          
          <div className="orderbook-section">
            <div className="orderbook-header">
              <div className="panel-title">Order Book</div>
            </div>
            <table className="orderbook-table">
              <thead>
                <tr>
                  <th className="price-col">Price</th>
                  <th className="amount-col">Amount</th>
                  <th className="qty-col">Qty</th>
                  <th className="total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {orderBook.slice(0, 20).map((order, index) => (
                  <tr key={index}>
                    <td className="price-col">
                      <span>{order.price?.toFixed(6) || '-'}</span>
                    </td>
                    <td className="amount-col">
                      <span>{order.amount || '-'}</span>
                    </td>
                    <td className="qty-col">
                      <span>{order.orders || 1}</span>
                    </td>
                    <td className="total-col">
                      <span>{((order.price || 0) * (order.amount || 0)).toFixed(6)}</span>
                    </td>
                  </tr>
                ))}
                {orderBook.length === 0 && (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center' }}>No orders</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Session Key Management (if connected) */}
      {isConnected && (
        <div className="panel" style={{ marginTop: 'calc(var(--s) * 3)' }}>
          <div className="panel-header">
            <div className="panel-title">🔑 AGW Session Key</div>
          </div>
          {sessionKey ? (
            <div>
              <p style={{ color: 'var(--success)', marginBottom: 'calc(var(--s) * 2)' }}>
                ✅ Session Active: {sessionKey.slice(0, 12)}...{sessionKey.slice(-4)}
              </p>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--muted-fg)', fontSize: '0.7rem', marginBottom: 'calc(var(--s) * 2)' }}>
                Create a session key for bulk transactions without individual approvals.
              </p>
              <button onClick={createSessionKey} disabled={loading}>
                {loading ? 'Creating Session Key...' : 'Create Session Key'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Main App Component
function App() {
  return (
    <AGWProvider>
      <div className="app">
        <TradingDashboard />
      </div>
    </AGWProvider>
  );
}

export default App;
