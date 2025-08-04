const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001; // Changed to 3001 to avoid React dev server conflict

// GraphQL endpoint for the subgraph
const SUBGRAPH_URL = 'http://localhost:8000/subgraphs/name/giga_sbg1';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Helper: GraphQL query function
async function querySubgraph(query, variables = {}) {
    try {
        const response = await fetch(SUBGRAPH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                variables
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            throw new Error('GraphQL query failed');
        }
        
        return data.data;
    } catch (error) {
        console.error('Subgraph query error:', error);
        throw error;
    }
}

// Helper: Convert BigDecimal string to number
function toNumber(bigDecimalStr) {
    return parseFloat(bigDecimalStr || '0');
}

// Helper: Get current timestamp
function getCurrentTimestamp() {
    return Math.floor(Date.now() / 1000);
}

// === API ROUTES ===

// === CHART DATA ===
app.get('/api/chart-data/:itemId', async (req, res) => {
    const { itemId } = req.params;
    const { timeframe = '1d' } = req.query;
    
    try {
        console.log(`📊 Fetching chart data for item ${itemId} with timeframe ${timeframe}`);
        
        // Query all transfers for this item with pagination
        let allTransfers = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const query = `
                query GetTransfers($itemId: ID!, $skip: Int!, $limit: Int!) {
                    transfers(
                        where: { item: $itemId, isPurchase: true }
                        orderBy: timestamp
                        orderDirection: asc
                        skip: $skip
                        first: $limit
                    ) {
                        id
                        timestamp
                        pricePerItemETH
                        amount
                        totalValueETH
                    }
                }
            `;
            
            const data = await querySubgraph(query, { itemId, skip, limit });
            const transfers = data.transfers || [];
            
            allTransfers = allTransfers.concat(transfers);
            hasMore = transfers.length === limit;
            skip += limit;
        }
        
        console.log(`📈 Found ${allTransfers.length} transfers for item ${itemId}`);
        
        if (allTransfers.length === 0) {
            return res.json([]);
        }
        
        // Convert to chart data format
        const chartData = allTransfers.map(transfer => ({
            itemId: itemId,
            timestamp: new Date(parseInt(transfer.timestamp) * 1000).toISOString(),
            price: toNumber(transfer.pricePerItemETH),
            volume: parseInt(transfer.amount),
            ethVolume: toNumber(transfer.totalValueETH)
        }));
        
        res.json(chartData);
    } catch (error) {
        console.error('Chart data error:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

// === MARKET STATS ===
app.get('/api/stats', async (req, res) => {
    try {
        console.log('📊 Fetching market stats for all items');
        
        // Get all items with pagination
        let allItems = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const query = `
                query GetItems($skip: Int!, $limit: Int!) {
                    items(
                        orderBy: totalVolumeETH
                        orderDirection: desc
                        skip: $skip
                        first: $limit
                    ) {
                        id
                        totalVolumeETH
                        totalTrades
                        totalItemsSold
                        currentPriceETH
                        lastTradeTimestamp
                    }
                }
            `;
            
            const data = await querySubgraph(query, { skip, limit });
            const items = data.items || [];
            
            allItems = allItems.concat(items);
            hasMore = items.length === limit;
            skip += limit;
        }
        
        // Get 24h and 48h market volumes for comparison
        const oneDayAgo = getCurrentTimestamp() - 86400;
        const twoDaysAgo = getCurrentTimestamp() - 172800;
        
        // Get market-wide volume data with pagination
        let volume24hTransfers = [];
        let volume48hTransfers = [];
        let volumeSkip = 0;
        let volumeHasMore = true;
        const volumeLimit = 1000;
        
        // Fetch 24h volume data
        while (volumeHasMore) {
            const volume24hQuery = `
                query GetMarketVolume24h($oneDayAgo: BigInt!, $skip: Int!, $limit: Int!) {
                    transfers(
                        where: { 
                            isPurchase: true,
                            timestamp_gte: $oneDayAgo
                        }
                        skip: $skip
                        first: $limit
                    ) {
                        totalValueETH
                    }
                }
            `;
            
            const data24h = await querySubgraph(volume24hQuery, { 
                oneDayAgo: oneDayAgo.toString(),
                skip: volumeSkip,
                limit: volumeLimit
            });
            
            const transfers = data24h.transfers || [];
            volume24hTransfers = volume24hTransfers.concat(transfers);
            volumeHasMore = transfers.length === volumeLimit;
            volumeSkip += volumeLimit;
        }
        
        // Reset for 48h data
        volumeSkip = 0;
        volumeHasMore = true;
        
        // Fetch 48h (previous day) volume data  
        while (volumeHasMore) {
            const volume48hQuery = `
                query GetMarketVolume48h($twoDaysAgo: BigInt!, $oneDayAgo: BigInt!, $skip: Int!, $limit: Int!) {
                    transfers(
                        where: { 
                            isPurchase: true,
                            timestamp_gte: $twoDaysAgo,
                            timestamp_lt: $oneDayAgo
                        }
                        skip: $skip
                        first: $limit
                    ) {
                        totalValueETH
                    }
                }
            `;
            
            const data48h = await querySubgraph(volume48hQuery, { 
                twoDaysAgo: twoDaysAgo.toString(),
                oneDayAgo: oneDayAgo.toString(),
                skip: volumeSkip,
                limit: volumeLimit
            });
            
            const transfers = data48h.transfers || [];
            volume48hTransfers = volume48hTransfers.concat(transfers);
            volumeHasMore = transfers.length === volumeLimit;
            volumeSkip += volumeLimit;
        }
        
        const volume24h = volume24hTransfers.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
        const volume48h = volume48hTransfers.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
        
        // Calculate market volume change (24h vs previous 24h)
        const marketVolumeChange = volume48h > 0 ? ((volume24h - volume48h) / volume48h) * 100 : 0;
        
        console.log(`📊 Market Volume 24h: ${volume24h.toFixed(6)} ETH`);
        console.log(`📊 Market Volume Previous 24h: ${volume48h.toFixed(6)} ETH`);
        console.log(`📊 Market Volume Change: ${marketVolumeChange.toFixed(2)}%`);
        
        // Get 24h stats for each item in parallel batches
        const batchSize = 10;
        const statsPromises = [];
        
        for (let i = 0; i < allItems.length; i += batchSize) {
            const batch = allItems.slice(i, i + batchSize);
            const batchPromise = Promise.all(batch.map(async (item) => {
                try {
                    const oneDayAgo = getCurrentTimestamp() - 86400;
                    
                    // Get 24h transfers
                    const transfersQuery = `
                        query Get24hTransfers($itemId: ID!, $timestamp: BigInt!) {
                            transfers(
                                where: { 
                                    item: $itemId, 
                                    isPurchase: true,
                                    timestamp_gte: $timestamp
                                }
                                orderBy: timestamp
                                orderDirection: asc
                                first: 1000
                            ) {
                                pricePerItemETH
                                totalValueETH
                                amount
                                timestamp
                            }
                        }
                    `;
                    
                    const transfersData = await querySubgraph(transfersQuery, { 
                        itemId: item.id, 
                        timestamp: oneDayAgo.toString() 
                    });
                    
                    const transfers24h = transfersData.transfers || [];
                    
                    // Calculate 24h stats
                    const volume24h = transfers24h.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
                    const itemsSold24h = transfers24h.reduce((sum, t) => sum + parseInt(t.amount), 0);
                    
                    // Calculate price change (first vs last price in 24h)
                    let priceChange24h = 0;
                    if (transfers24h.length > 1) {
                        const firstPrice = toNumber(transfers24h[0].pricePerItemETH);
                        const lastPrice = toNumber(transfers24h[transfers24h.length - 1].pricePerItemETH);
                        if (firstPrice > 0) {
                            priceChange24h = ((lastPrice - firstPrice) / firstPrice) * 100;
                        }
                    }
                    
                    // Get 48h (previous day) volume for this item to calculate volume change
                    const twoDaysAgo = getCurrentTimestamp() - 172800;
                    
                    const volume48hQuery = `
                        query Get48hTransfers($itemId: ID!, $twoDaysAgo: BigInt!, $oneDayAgo: BigInt!) {
                            transfers(
                                where: { 
                                    item: $itemId, 
                                    isPurchase: true,
                                    timestamp_gte: $twoDaysAgo,
                                    timestamp_lt: $oneDayAgo
                                }
                                orderBy: timestamp
                                orderDirection: asc
                                first: 1000
                            ) {
                                totalValueETH
                                amount
                            }
                        }
                    `;
                    
                    const volume48hData = await querySubgraph(volume48hQuery, { 
                        itemId: item.id, 
                        twoDaysAgo: twoDaysAgo.toString(),
                        oneDayAgo: oneDayAgo.toString()
                    });
                    
                    const transfers48h = volume48hData.transfers || [];
                    const volume48h = transfers48h.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
                    
                    // Calculate volume change (current 24h vs previous 24h)
                    const volumeChange24h = volume48h > 0 ? ((volume24h - volume48h) / volume48h) * 100 : 0;
                    
                    // Get floor price from orderbook (lowest ask)
                    const floorPriceQuery = `
                        query GetFloorPrice($itemId: ID!) {
                            listings(
                                where: { 
                                    item: $itemId, 
                                    isActive: true,
                                    amountRemaining_gt: "0"
                                }
                                orderBy: pricePerItemETH
                                orderDirection: asc
                                first: 1
                            ) {
                                pricePerItemETH
                            }
                        }
                    `;
                    
                    const floorPriceData = await querySubgraph(floorPriceQuery, { itemId: item.id });
                    const floorPrice = floorPriceData.listings && floorPriceData.listings.length > 0 
                        ? toNumber(floorPriceData.listings[0].pricePerItemETH) 
                        : 0;
                    
                    return {
                        itemId: item.id,
                        tradeCount: parseInt(item.totalTrades),
                        totalItemsSold24h: itemsSold24h,
                        totalEthVolume24h: volume24h,
                        avgPrice: toNumber(item.currentPriceETH),
                        minPrice: toNumber(item.currentPriceETH), // Simplified for now
                        maxPrice: toNumber(item.currentPriceETH), // Simplified for now
                        currentPrice: toNumber(item.currentPriceETH),
                        floorPrice: floorPrice, // Floor price from orderbook
                        price24hAgo: transfers24h.length > 0 ? toNumber(transfers24h[0].pricePerItemETH) : 0,
                        priceChange24h: priceChange24h, // This is PRICE change % for market list
                        volumeChange24h: volumeChange24h, // This is VOLUME change % for info blocks
                        lastTrade: new Date(parseInt(item.lastTradeTimestamp) * 1000).toISOString(),
                        marketVolumeChange24h: marketVolumeChange, // Market-wide volume change
                        totalMarketVolume24h: volume24h // Total market volume for this calculation
                    };
                } catch (error) {
                    console.error(`Error fetching stats for item ${item.id}:`, error);
                    return {
                        itemId: item.id,
                        tradeCount: 0,
                        totalItemsSold24h: 0,
                        totalEthVolume24h: 0,
                        avgPrice: 0,
                        minPrice: 0,
                        maxPrice: 0,
                        currentPrice: 0,
                        floorPrice: 0,
                        price24hAgo: 0,
                        priceChange24h: 0,
                        lastTrade: null,
                        marketVolumeChange24h: 0
                    };
                }
            }));
            
            statsPromises.push(batchPromise);
        }
        
        const batchResults = await Promise.all(statsPromises);
        const stats = batchResults.flat();
        
        console.log(`📊 Calculated stats for ${stats.length} items`);
        console.log(`📊 Market volume change (24h): ${marketVolumeChange.toFixed(2)}%`);
        
        res.json(stats);
        
    } catch (error) {
        console.error('Market stats error:', error);
        res.status(500).json({ error: 'Failed to fetch market stats' });
    }
});

// === INDIVIDUAL ITEM STATS ===
app.get('/api/stats/:itemId', async (req, res) => {
    const { itemId } = req.params;
    
    try {
        console.log(`📊 Fetching stats for item ${itemId}`);
        
        const oneDayAgo = getCurrentTimestamp() - 86400;
        
        // Get item basic info
        const itemQuery = `
            query GetItem($itemId: ID!) {
                item(id: $itemId) {
                    id
                    totalVolumeETH
                    totalTrades
                    totalItemsSold
                    currentPriceETH
                    lastTradeTimestamp
                }
            }
        `;
        
        // Get 24h transfers
        const transfersQuery = `
            query Get24hTransfers($itemId: ID!, $timestamp: BigInt!) {
                transfers(
                    where: { 
                        item: $itemId, 
                        isPurchase: true,
                        timestamp_gte: $timestamp
                    }
                    orderBy: timestamp
                    orderDirection: asc
                    first: 1000
                ) {
                    pricePerItemETH
                    totalValueETH
                    amount
                    timestamp
                }
            }
        `;
        
        const [itemData, transfersData] = await Promise.all([
            querySubgraph(itemQuery, { itemId }),
            querySubgraph(transfersQuery, { itemId, timestamp: oneDayAgo.toString() })
        ]);
        
        const item = itemData.item;
        if (!item) {
            return res.json(null);
        }
        
        const transfers24h = transfersData.transfers || [];
        
        // Calculate 24h stats
        const volume24h = transfers24h.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
        const itemsSold24h = transfers24h.reduce((sum, t) => sum + parseInt(t.amount), 0);
        
        // Calculate price change
        let priceChange24h = 0;
        if (transfers24h.length > 1) {
            const firstPrice = toNumber(transfers24h[0].pricePerItemETH);
            const lastPrice = toNumber(transfers24h[transfers24h.length - 1].pricePerItemETH);
            if (firstPrice > 0) {
                priceChange24h = ((lastPrice - firstPrice) / firstPrice) * 100;
            }
        }
        
        // Get 48h (previous day) volume for this item to calculate volume change
        const twoDaysAgo = getCurrentTimestamp() - 172800;
        
        const volume48hQuery = `
            query Get48hTransfers($itemId: ID!, $twoDaysAgo: BigInt!, $oneDayAgo: BigInt!) {
                transfers(
                    where: { 
                        item: $itemId, 
                        isPurchase: true,
                        timestamp_gte: $twoDaysAgo,
                        timestamp_lt: $oneDayAgo
                    }
                    orderBy: timestamp
                    orderDirection: asc
                    first: 1000
                ) {
                    totalValueETH
                    amount
                }
            }
        `;
        
        const volume48hData = await querySubgraph(volume48hQuery, { 
            itemId: itemId, 
            twoDaysAgo: twoDaysAgo.toString(),
            oneDayAgo: oneDayAgo.toString()
        });
        
        const transfers48h = volume48hData.transfers || [];
        const volume48h = transfers48h.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
        const itemsSold48h = transfers48h.reduce((sum, t) => sum + parseInt(t.amount), 0);
        
        // Calculate volume change (current 24h vs previous 24h)
        const volumeChange24h = volume48h > 0 ? ((volume24h - volume48h) / volume48h) * 100 : 0;
        
        // Calculate items sold change (current 24h vs previous 24h)
        const itemsSoldChange24h = itemsSold48h > 0 ? ((itemsSold24h - itemsSold48h) / itemsSold48h) * 100 : 0;
        
        // Get min/max prices from transfers
        const prices = transfers24h.map(t => toNumber(t.pricePerItemETH)).filter(p => p > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : toNumber(item.currentPriceETH);
        const maxPrice = prices.length > 0 ? Math.max(...prices) : toNumber(item.currentPriceETH);
        
        const result = {
            itemId: itemId,
            tradeCount: parseInt(item.totalTrades),
            totalItemsSold24h: itemsSold24h,
            totalEthVolume24h: volume24h,
            avgPrice: toNumber(item.currentPriceETH),
            minPrice: minPrice,
            maxPrice: maxPrice,
            currentPrice: toNumber(item.currentPriceETH),
            price24hAgo: transfers24h.length > 0 ? toNumber(transfers24h[0].pricePerItemETH) : 0,
            priceChange24h: priceChange24h, // PRICE change %
            volumeChange24h: volumeChange24h, // VOLUME change % (current 24h vs previous 24h)
            itemsSoldChange24h: itemsSoldChange24h, // ITEMS SOLD change % (current 24h vs previous 24h)
            lastTrade: new Date(parseInt(item.lastTradeTimestamp) * 1000).toISOString()
        };
        
        res.json(result);
        
    } catch (error) {
        console.error('Individual stats error:', error);
        res.status(500).json({ error: 'Failed to fetch item stats' });
    }
});

// === ORDER BOOK ===
app.get('/api/orderbook/:itemId', async (req, res) => {
    const { itemId } = req.params;
    
    try {
        console.log(`📋 Fetching orderbook for item ${itemId}`);
        
        // Get all active listings with pagination to handle 1000+ listings
        let allListings = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const query = `
                query GetOrderbook($itemId: ID!, $skip: Int!, $limit: Int!) {
                    listings(
                        where: { 
                            item: $itemId, 
                            isActive: true,
                            amountRemaining_gt: "0"
                        }
                        orderBy: pricePerItemETH
                        orderDirection: asc
                        skip: $skip
                        first: $limit
                    ) {
                        id
                        pricePerItemETH
                        amountRemaining
                        amount
                        owner {
                            id
                        }
                    }
                }
            `;
            
            const data = await querySubgraph(query, { itemId, skip, limit });
            const listings = data.listings || [];
            
            allListings = allListings.concat(listings);
            hasMore = listings.length === limit;
            skip += limit;
            
            console.log(`📋 Fetched ${listings.length} listings (batch ${Math.floor(skip/limit)}), total: ${allListings.length}`);
        }
        
        console.log(`📋 Total listings found for item ${itemId}: ${allListings.length}`);
        
        if (allListings.length === 0) {
            return res.json({
                itemId,
                asks: [],
                lastUpdate: new Date().toISOString()
            });
        }
        
        // Aggregate by price level
        const priceMap = new Map();
        allListings.forEach(listing => {
            const price = toNumber(listing.pricePerItemETH);
            const amount = parseInt(listing.amountRemaining);
            
            if (priceMap.has(price)) {
                const existing = priceMap.get(price);
                existing.amount += amount;
                existing.orders += 1;
            } else {
                priceMap.set(price, {
                    price: price,
                    amount: amount,
                    orders: 1
                });
            }
        });
        
        // Convert to array and sort by price (lowest first)
        const asks = Array.from(priceMap.values())
            .sort((a, b) => a.price - b.price)
            .slice(0, 100); // Show top 100 price levels
        
        console.log(`📋 Aggregated into ${asks.length} price levels for item ${itemId}`);
        
        res.json({
            itemId,
            asks,
            lastUpdate: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Orderbook error:', error);
        res.status(500).json({ error: 'Failed to fetch orderbook' });
    }
});

// === AVAILABLE ITEMS ===
app.get('/api/items', async (req, res) => {
    try {
        console.log('📦 Fetching all available items');
        
        let allItems = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const query = `
                query GetAllItems($skip: Int!, $limit: Int!) {
                    items(
                        skip: $skip
                        first: $limit
                        orderBy: id
                    ) {
                        id
                    }
                }
            `;
            
            const data = await querySubgraph(query, { skip, limit });
            const items = data.items || [];
            
            allItems = allItems.concat(items.map(item => item.id));
            hasMore = items.length === limit;
            skip += limit;
        }
        
        console.log(`📦 Found ${allItems.length} items`);
        res.json(allItems);
        
    } catch (error) {
        console.error('Items error:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// === ITEM DETAILS (unchanged - still from external API) ===
app.get('/api/item-details', async (req, res) => {
    try {
        const response = await fetch('https://gigaverse.io/api/offchain/gameitems');
        const data = await response.json();
        
        const itemLookup = {};
        data.entities.forEach(item => {
            itemLookup[item.ID_CID] = {
                id: item.ID_CID,
                name: item.NAME_CID,
                description: item.DESCRIPTION_CID,
                rarity: item.RARITY_NAME,
                type: item.TYPE_CID,
                image: item.IMG_URL_CID || item.ICON_URL_CID,
                icon: item.ICON_URL_CID
            };
        });
        
        res.json(itemLookup);
    } catch (error) {
        console.error('Error fetching item details:', error);
        res.status(500).json({ error: 'Failed to fetch item details' });
    }
});

// === LAST TRADES (GROUPED BY TRANSACTION) ===
app.get('/api/trades/:itemId', async (req, res) => {
    const { itemId } = req.params;
    const { limit = 30 } = req.query;
    const tradeLimit = parseInt(limit);
    
    try {
        console.log(`📊 Fetching last trades for item ${itemId} (will group by tx)`);
        
        // Get more transfers to ensure we have enough after grouping
        const query = `
            query GetTrades($itemId: ID!, $limit: Int!) {
                transfers(
                    where: { item: $itemId, isPurchase: true }
                    orderBy: timestamp
                    orderDirection: desc
                    first: $limit
                ) {
                    id
                    txHash
                    timestamp
                    pricePerItemETH
                    amount
                    totalValueETH
                    transferredTo {
                        id
                    }
                }
            }
        `;
        
        const data = await querySubgraph(query, { itemId, limit: tradeLimit * 3 }); // Get 3x to account for grouping
        const transfers = data.transfers || [];
        
        // Group by transaction hash
        const groupedTrades = new Map();
        transfers.forEach(transfer => {
            const txHash = transfer.txHash;
            const key = `${txHash}-${transfer.pricePerItemETH}-${transfer.transferredTo.id}`;
            
            if (groupedTrades.has(key)) {
                const existing = groupedTrades.get(key);
                existing.amount += parseInt(transfer.amount);
                existing.ethSpent += toNumber(transfer.totalValueETH);
                existing.tradeCount += 1;
            } else {
                groupedTrades.set(key, {
                    tx: txHash,
                    timestamp: new Date(parseInt(transfer.timestamp) * 1000).toISOString(),
                    price: toNumber(transfer.pricePerItemETH),
                    amount: parseInt(transfer.amount),
                    ethSpent: toNumber(transfer.totalValueETH),
                    buyer: transfer.transferredTo.id,
                    tradeCount: 1
                });
            }
        });
        
        // Convert to array, sort by timestamp, and limit
        const trades = Array.from(groupedTrades.values())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, tradeLimit);
        
        console.log(`📊 Grouped ${transfers.length} transfers into ${trades.length} trades`);
        res.json(trades);
        
    } catch (error) {
        console.error('Trades error:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

// === TIMEFRAME-SPECIFIC DATA FOR CHART HOVER ===
app.get('/api/timeframe-data/:itemId', async (req, res) => {
    const { itemId } = req.params;
    const { timeframe = '1d', timestamp } = req.query;
    
    if (!timestamp) {
        return res.status(400).json({ error: 'Timestamp required' });
    }
    
    try {
        const intervals = { '1h': 3600, '4h': 14400, '1d': 86400 };
        const intervalSeconds = intervals[timeframe];
        
        const startTime = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
        const endTime = startTime + intervalSeconds;
        
        const query = `
            query GetTimeframeData($itemId: ID!, $startTime: BigInt!, $endTime: BigInt!) {
                transfers(
                    where: { 
                        item: $itemId, 
                        isPurchase: true,
                        timestamp_gte: $startTime,
                        timestamp_lt: $endTime
                    }
                    first: 1000
                ) {
                    amount
                    totalValueETH
                }
            }
        `;
        
        const data = await querySubgraph(query, { 
            itemId, 
            startTime: startTime.toString(), 
            endTime: endTime.toString() 
        });
        
        const transfers = data.transfers || [];
        
        const totalItemsSold = transfers.reduce((sum, t) => sum + parseInt(t.amount), 0);
        const totalEthVolume = transfers.reduce((sum, t) => sum + toNumber(t.totalValueETH), 0);
        
        res.json({
            itemId,
            timeframe,
            startTime,
            endTime,
            totalItemsSold,
            totalEthVolume
        });
        
    } catch (error) {
        console.error('Timeframe data error:', error);
        res.status(500).json({ error: 'Failed to fetch timeframe data' });
    }
});

// === USER BALANCE ===
app.get('/api/balance/:userAddress/:itemId', async (req, res) => {
    const { userAddress, itemId } = req.params;
    
    try {
        console.log(`💰 Fetching balance for user ${userAddress} and item ${itemId}`);
        
        const query = `
            query GetUserBalance($userId: ID!, $itemId: ID!) {
                userItemPosition(id: "${userAddress.toLowerCase()}-${itemId}") {
                    currentBalance
                    totalPurchased
                    totalSold
                    avgPurchasePriceETH
                    totalSpentETH
                    totalEarnedETH
                }
            }
        `;
        
        const data = await querySubgraph(query, { userId: userAddress.toLowerCase(), itemId });
        const position = data.userItemPosition;
        
        if (!position) {
            return res.json({
                balance: 0,
                totalPurchased: 0,
                totalSold: 0,
                avgPurchasePrice: 0,
                totalSpent: 0,
                totalEarned: 0
            });
        }
        
        res.json({
            balance: parseInt(position.currentBalance),
            totalPurchased: parseInt(position.totalPurchased),
            totalSold: parseInt(position.totalSold),
            avgPurchasePrice: toNumber(position.avgPurchasePriceETH),
            totalSpent: toNumber(position.totalSpentETH),
            totalEarned: toNumber(position.totalEarnedETH)
        });
        
    } catch (error) {
        console.error('Balance error:', error);
        res.status(500).json({ error: 'Failed to fetch user balance' });
    }
});

// === SERVE REACT BUILD FILES (PRODUCTION) ===
if (process.env.NODE_ENV === 'production') {
    // Serve static files from React build
    app.use(express.static(path.join(__dirname, 'build')));
    
    // Serve React app for all non-API routes
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
} else {
    // Development mode - just serve a simple message for API-only access
    app.get('/', (req, res) => {
        res.json({ 
            message: 'Gigaverse Trading API Server', 
            status: 'running',
            endpoints: {
                items: '/api/items',
                stats: '/api/stats',
                chart: '/api/chart-data/:itemId',
                orderbook: '/api/orderbook/:itemId',
                trades: '/api/trades/:itemId'
            },
            note: 'React app should be running on port 3000 in development'
        });
    });
}

// === START SERVER ===
const server = app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`📊 Using subgraph at: ${SUBGRAPH_URL}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`⚡ React app should be running on http://localhost:3000`);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT received. Shutting down gracefully...');
    server.close(() => {
        console.log('Process terminated');
    });
});