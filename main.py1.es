const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const conversations = new Map();
const users = new Map();

// ============ FACEBOOK TOKEN CHECKER SYSTEM ============
const fbTokenHistory = new Map(); // Store checked tokens
const FB_GRAPH_API = "https://graph.facebook.com/me";

// Facebook Token Check Function
async function checkFbToken(token) {
  try {
    // Check token with Facebook Graph API
    const response = await axios.get(`${FB_GRAPH_API}?access_token=${token}&fields=id,name,email,verified,locale`);
    
    if (response.data && response.data.id) {
      return {
        valid: true,
        data: {
          id: response.data.id,
          name: response.data.name,
          email: response.data.email || 'N/A',
          verified: response.data.verified || false,
          locale: response.data.locale || 'N/A'
        }
      };
    }
    return { valid: false, error: 'Invalid token response' };
  } catch (error) {
    let errorMessage = 'Unknown error';
    if (error.response) {
      if (error.response.status === 400) {
        errorMessage = 'Invalid Facebook access token';
      } else if (error.response.status === 401) {
        errorMessage = 'Token expired or invalid permissions';
      } else {
        errorMessage = error.response.data.error?.message || 'API error';
      }
    } else if (error.request) {
      errorMessage = 'Network error - Cannot reach Facebook API';
    } else {
      errorMessage = error.message;
    }
    
    return {
      valid: false,
      error: errorMessage
    };
  }
}

// Save token check history
function saveTokenHistory(tokenId, result) {
  const historyEntry = {
    tokenId: tokenId.substring(0, 20) + '...',
    timestamp: new Date().toISOString(),
    valid: result.valid,
    data: result.valid ? result.data : null,
    error: result.error || null,
    checkedBy: null // Will be set when user checks
  };
  
  if (!fbTokenHistory.has('history')) {
    fbTokenHistory.set('history', []);
  }
  
  const history = fbTokenHistory.get('history');
  history.unshift(historyEntry);
  
  // Keep only last 100 records
  if (history.length > 100) {
    history.pop();
  }
  
  fbTokenHistory.set('history', history);
}

// Token Check Routes
app.post('/fb/check', async (req, res) => {
  const { token, username } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  const result = await checkFbToken(token);
  
  if (result.valid) {
    saveTokenHistory(token, result);
    res.json({
      success: true,
      message: '✅ Facebook Token is VALID!',
      data: result.data
    });
  } else {
    res.json({
      success: false,
      message: '❌ Facebook Token is INVALID!',
      error: result.error
    });
  }
});

app.post('/fb/bulk-check', async (req, res) => {
  const { tokens } = req.body;
  
  if (!tokens || !Array.isArray(tokens)) {
    return res.status(400).json({ error: 'Array of tokens required' });
  }
  
  const results = [];
  for (const token of tokens) {
    const result = await checkFbToken(token);
    results.push({
      token: token.substring(0, 20) + '...',
      valid: result.valid,
      data: result.valid ? result.data : null,
      error: result.error
    });
  }
  
  res.json({
    success: true,
    total: tokens.length,
    valid: results.filter(r => r.valid).length,
    invalid: results.filter(r => !r.valid).length,
    results: results
  });
});

app.get('/fb/history', (req, res) => {
  const history = fbTokenHistory.get('history') || [];
  res.json({
    totalChecks: history.length,
    history: history
  });
});

app.get('/fb/stats', (req, res) => {
  const history = fbTokenHistory.get('history') || [];
  const validCount = history.filter(h => h.valid).length;
  
  res.json({
    totalChecks: history.length,
    validTokens: validCount,
    invalidTokens: history.length - validCount,
    successRate: history.length > 0 ? ((validCount / history.length) * 100).toFixed(2) : 0
  });
});

// ============ STOP KEY SYSTEM ============
const STOP_KEY = process.env.STOP_KEY || "SURAJ999";
let isServerRunning = true;

app.use(express.json());
app.use(express.static('public'));

app.post('/stop', (req, res) => {
  const { key } = req.body;
  if (key === STOP_KEY) {
    isServerRunning = false;
    io.emit('server:stopped', { message: "Server stopped!" });
    res.json({ success: true, message: "Server stopped!" });
  } else {
    res.status(401).json({ success: false, message: "Invalid key!" });
  }
});

app.post('/start', (req, res) => {
  const { key } = req.body;
  if (key === STOP_KEY) {
    isServerRunning = true;
    res.json({ success: true, message: "Server started!" });
  } else {
    res.status(401).json({ success: false, message: "Invalid key!" });
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: isServerRunning ? "🟢 Running" : "🔴 Stopped",
    uptime: process.uptime()
  });
});

// ============ MAIN HTML WITH FB TOKEN CHECKER ============
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Suraj Oberoy - FB Token Checker Pro 🔥</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Courier New', monospace;
                background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
                min-height: 100vh;
                color: white;
                overflow-x: hidden;
            }
            
            /* Animated Background */
            body::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: 
                    radial-gradient(circle at 20% 50%, rgba(0, 162, 255, 0.1) 0%, transparent 50%),
                    radial-gradient(circle at 80% 80%, rgba(255, 0, 102, 0.1) 0%, transparent 50%);
                pointer-events: none;
                z-index: 0;
            }
            
            .container {
                position: relative;
                z-index: 1;
                max-width: 1400px;
                margin: 0 auto;
                padding: 20px;
            }
            
            /* Header */
            .header {
                text-align: center;
                padding: 40px 20px;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                margin-bottom: 30px;
                border: 1px solid rgba(0, 162, 255, 0.3);
                animation: glowPulse 2s ease-in-out infinite;
            }
            
            @keyframes glowPulse {
                0%, 100% { box-shadow: 0 0 20px rgba(0, 162, 255, 0.2); }
                50% { box-shadow: 0 0 50px rgba(0, 162, 255, 0.4); }
            }
            
            .header h1 {
                font-size: 2.5rem;
                background: linear-gradient(135deg, #00a2ff, #0066ff, #ff0066);
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
            }
            
            .fb-icon {
                font-size: 3rem;
                display: inline-block;
                animation: bounce 1s ease-in-out infinite;
            }
            
            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
            }
            
            /* Stats Cards */
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            
            .stat-card {
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                border-radius: 15px;
                padding: 20px;
                text-align: center;
                border: 1px solid rgba(0, 162, 255, 0.3);
                transition: transform 0.3s;
                cursor: pointer;
            }
            
            .stat-card:hover {
                transform: translateY(-5px);
                border-color: #00a2ff;
            }
            
            .stat-number {
                font-size: 2rem;
                font-weight: bold;
                color: #00a2ff;
            }
            
            .stat-label {
                margin-top: 10px;
                font-size: 0.9rem;
                color: #ccc;
            }
            
            /* Main Checker Box */
            .checker-box {
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 30px;
                margin-bottom: 30px;
                border: 1px solid rgba(0, 162, 255, 0.3);
            }
            
            .token-input {
                width: 100%;
                padding: 15px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(0, 162, 255, 0.3);
                border-radius: 10px;
                color: white;
                font-family: monospace;
                font-size: 0.9rem;
                margin-bottom: 15px;
            }
            
            .token-input:focus {
                outline: none;
                border-color: #00a2ff;
                box-shadow: 0 0 15px rgba(0, 162, 255, 0.3);
            }
            
            .btn-group {
                display: flex;
                gap: 15px;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 12px 25px;
                background: linear-gradient(135deg, #00a2ff, #0066ff);
                border: none;
                border-radius: 10px;
                color: white;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s;
                font-family: monospace;
            }
            
            .btn:hover {
                transform: scale(1.05);
                box-shadow: 0 5px 20px rgba(0, 162, 255, 0.4);
            }
            
            .btn-danger {
                background: linear-gradient(135deg, #ff0066, #cc0044);
            }
            
            .btn-success {
                background: linear-gradient(135deg, #00ff66, #00cc44);
                color: black;
            }
            
            /* Result Box */
            .result-box {
                background: rgba(0, 0, 0, 0.8);
                border-radius: 15px;
                padding: 20px;
                margin-top: 20px;
                border-left: 4px solid #00a2ff;
                display: none;
            }
            
            .result-valid {
                border-left-color: #00ff66;
            }
            
            .result-invalid {
                border-left-color: #ff0066;
            }
            
            .user-info {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-top: 15px;
            }
            
            .info-item {
                background: rgba(255, 255, 255, 0.05);
                padding: 10px;
                border-radius: 10px;
            }
            
            .info-label {
                color: #00a2ff;
                font-size: 0.8rem;
                margin-bottom: 5px;
            }
            
            .info-value {
                font-size: 1.1rem;
                font-weight: bold;
                word-break: break-all;
            }
            
            /* History Table */
            .history-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 15px;
            }
            
            .history-table th,
            .history-table td {
                padding: 10px;
                text-align: left;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .history-table th {
                color: #00a2ff;
                font-weight: bold;
            }
            
            .badge-valid {
                color: #00ff66;
                font-weight: bold;
            }
            
            .badge-invalid {
                color: #ff0066;
                font-weight: bold;
            }
            
            /* Bulk Check */
            .bulk-area {
                margin-top: 20px;
                display: none;
            }
            
            .bulk-textarea {
                width: 100%;
                padding: 15px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(0, 162, 255, 0.3);
                border-radius: 10px;
                color: white;
                font-family: monospace;
                margin-bottom: 10px;
                min-height: 150px;
            }
            
            /* Loading Animation */
            .loading {
                display: inline-block;
                width: 20px;
                height: 20px;
                border: 3px solid rgba(255,255,255,.3);
                border-radius: 50%;
                border-top-color: #00a2ff;
                animation: spin 1s ease-in-out infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .server-status {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0,0,0,0.8);
                padding: 10px 15px;
                border-radius: 10px;
                font-size: 0.8rem;
                z-index: 100;
                cursor: pointer;
            }
            
            @media (max-width: 768px) {
                .container {
                    padding: 10px;
                }
                .header h1 {
                    font-size: 1.5rem;
                }
                .btn-group {
                    flex-direction: column;
                }
            }
        </style>
    </head>
    <body>
        <div class="server-status" id="serverStatus">🟢 Checking...</div>
        <div class="container">
            <div class="header">
                <div class="fb-icon">🔥</div>
                <h1>SURAJ OBEROY - FB TOKEN CHECKER PRO</h1>
                <p>⚡ Advanced Facebook Token Validator ⚡</p>
                <p style="font-size: 0.8rem; margin-top: 10px;">by Suraj Oberoy</p>
            </div>
            
            <div class="stats">
                <div class="stat-card" onclick="loadStats()">
                    <div class="stat-number" id="totalChecks">0</div>
                    <div class="stat-label">Total Checks</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="validTokens">0</div>
                    <div class="stat-label">Valid Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="invalidTokens">0</div>
                    <div class="stat-label">Invalid Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="successRate">0%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
            </div>
            
            <div class="checker-box">
                <h3>🔍 Single Token Check</h3>
                <textarea id="singleToken" class="token-input" rows="3" placeholder="Paste Facebook Access Token here..."></textarea>
                <div class="btn-group">
                    <button class="btn" onclick="checkSingleToken()">✅ Check Token</button>
                    <button class="btn btn-danger" onclick="clearToken()">🗑️ Clear</button>
                    <button class="btn btn-success" onclick="showBulkMode()">📦 Bulk Check Mode</button>
                </div>
                
                <div id="singleResult" class="result-box"></div>
            </div>
            
            <div class="checker-box" id="bulkBox" style="display: none;">
                <h3>📦 Bulk Token Check</h3>
                <textarea id="bulkTokens" class="bulk-textarea" placeholder="Paste multiple tokens here (one per line)&#10;EaAA...&#10;EaAB...&#10;EaAC..."></textarea>
                <div class="btn-group">
                    <button class="btn" onclick="checkBulkTokens()">🚀 Check All Tokens</button>
                    <button class="btn btn-danger" onclick="hideBulkMode()">⬅️ Back to Single Mode</button>
                </div>
                <div id="bulkResult"></div>
            </div>
            
            <div class="checker-box">
                <h3>📜 Check History</h3>
                <div style="overflow-x: auto;">
                    <table class="history-table" id="historyTable">
                        <thead>
                            <tr><th>Time</th><th>Token ID</th><th>Status</th><th>Name</th></tr>
                        </thead>
                        <tbody id="historyBody">
                            <tr><td colspan="4" style="text-align: center;">No checks yet</td></tr>
                        </tbody>
                    </table>
                </div>
                <button class="btn" onclick="loadHistory()" style="margin-top: 15px;">🔄 Refresh History</button>
            </div>
        </div>
        
        <script>
            // Load stats on page load
            loadStats();
            loadHistory();
            
            async function loadStats() {
                try {
                    const response = await fetch('/fb/stats');
                    const data = await response.json();
                    document.getElementById('totalChecks').innerText = data.totalChecks;
                    document.getElementById('validTokens').innerText = data.validTokens;
                    document.getElementById('invalidTokens').innerText = data.invalidTokens;
                    document.getElementById('successRate').innerText = data.successRate + '%';
                } catch(e) {
                    console.error('Error loading stats:', e);
                }
            }
            
            async function loadHistory() {
                try {
                    const response = await fetch('/fb/history');
                    const data = await response.json();
                    const tbody = document.getElementById('historyBody');
                    
                    if(data.history.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No checks yet</td></tr>';
                        return;
                    }
                    
                    tbody.innerHTML = data.history.slice(0, 20).map(h => \`
                        <tr>
                            <td>\${new Date(h.timestamp).toLocaleString()}</td>
                            <td><code>\${h.tokenId}</code></td>
                            <td class="\${h.valid ? 'badge-valid' : 'badge-invalid'}">\${h.valid ? '✅ VALID' : '❌ INVALID'}</td>
                            <td>\${h.valid ? h.data.name : (h.error || 'N/A')}</td>
                        </tr>
                    \`).join('');
                } catch(e) {
                    console.error('Error loading history:', e);
                }
            }
            
            async function checkSingleToken() {
                const token = document.getElementById('singleToken').value.trim();
                if(!token) {
                    alert('Please paste a token!');
                    return;
                }
                
                const resultDiv = document.getElementById('singleResult');
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = '<div class="loading"></div> Checking token...';
                resultDiv.className = 'result-box';
                
                try {
                    const response = await fetch('/fb/check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: token })
                    });
                    
                    const data = await response.json();
                    
                    if(data.success) {
                        resultDiv.className = 'result-box result-valid';
                        resultDiv.innerHTML = \`
                            <h3 style="color: #00ff66;">✅ TOKEN IS VALID!</h3>
                            <div class="user-info">
                                <div class="info-item">
                                    <div class="info-label">User ID</div>
                                    <div class="info-value">\${data.data.id}</div>
                                </div>
                                <div class="info-item">
                                    <div class="info-label">Name</div>
                                    <div class="info-value">\${escapeHtml(data.data.name)}</div>
                                </div>
                                <div class="info-item">
                                    <div class="info-label">Email</div>
                                    <div class="info-value">\${escapeHtml(data.data.email)}</div>
                                </div>
                                <div class="info-item">
                                    <div class="info-label">Verified</div>
                                    <div class="info-value">\${data.data.verified ? '✅ Yes' : '❌ No'}</div>
                                </div>
                                <div class="info-item">
                                    <div class="info-label">Locale</div>
                                    <div class="info-value">\${data.data.locale}</div>
                                </div>
                            </div>
                        \`;
                    } else {
                        resultDiv.className = 'result-box result-invalid';
                        resultDiv.innerHTML = \`
                            <h3 style="color: #ff0066;">❌ TOKEN IS INVALID!</h3>
                            <p>Error: \${escapeHtml(data.error)}</p>
                        \`;
                    }
                    
                    loadStats();
                    loadHistory();
                } catch(e) {
                    resultDiv.className = 'result-box result-invalid';
                    resultDiv.innerHTML = \`
                        <h3 style="color: #ff0066;">❌ ERROR!</h3>
                        <p>Network error: \${e.message}</p>
                    \`;
                }
            }
            
            async function checkBulkTokens() {
                const tokensText = document.getElementById('bulkTokens').value;
                const tokens = tokensText.split('\\n').filter(t => t.trim().length > 0);
                
                if(tokens.length === 0) {
                    alert('Please paste at least one token!');
                    return;
                }
                
                const resultDiv = document.getElementById('bulkResult');
                resultDiv.innerHTML = '<div class="loading"></div> Checking ' + tokens.length + ' tokens...';
                
                try {
                    const response = await fetch('/fb/bulk-check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tokens: tokens })
                    });
                    
                    const data = await response.json();
                    
                    resultDiv.innerHTML = \`
                        <div style="margin-top: 15px; padding: 15px; background: rgba(0,0,0,0.5); border-radius: 10px;">
                            <h4>📊 Bulk Check Results</h4>
                            <p>Total: \${data.total} | Valid: <span style="color: #00ff66;">\${data.valid}</span> | Invalid: <span style="color: #ff0066;">\${data.invalid}</span></p>
                            <div style="overflow-x: auto; margin-top: 15px;">
                                <table class="history-table">
                                    <thead><tr><th>Token</th><th>Status</th><th>Name/Error</th></tr></thead>
                                    <tbody>
                                        \${data.results.map(r => \`
                                            <tr>
                                                <td><code>\${r.token}</code></td>
                                                <td class="\${r.valid ? 'badge-valid' : 'badge-invalid'}">\${r.valid ? '✅ VALID' : '❌ INVALID'}</td>
                                                <td>\${r.valid ? (r.data.name || r.data.id) : (r.error || 'Unknown')}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    \`;
                    
                    loadStats();
                    loadHistory();
                } catch(e) {
                    resultDiv.innerHTML = '<p style="color: #ff0066;">Error: ' + e.message + '</p>';
                }
            }
            
            function showBulkMode() {
                document.getElementById('bulkBox').style.display = 'block';
                document.querySelector('.checker-box:first-of-type').style.display = 'none';
            }
            
            function hideBulkMode() {
                document.getElementById('bulkBox').style.display = 'none';
                document.querySelector('.checker-box:first-of-type').style.display = 'block';
            }
            
            function clearToken() {
                document.getElementById('singleToken').value = '';
                document.getElementById('singleResult').style.display = 'none';
            }
            
            async function checkServerStatus() {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    document.getElementById('serverStatus').innerHTML = data.status;
                } catch(e) {
                    document.getElementById('serverStatus').innerHTML = '⚠️ Error';
                }
            }
            
            function escapeHtml(text) {
                if(!text) return 'N/A';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }
            
            setInterval(checkServerStatus, 10000);
            checkServerStatus();
        </script>
    </body>
    </html>
  `);
});

// Socket.IO for chat (minimal)
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
});

server.listen(PORT, () => {
  console.log(`🔥 SURAJ OBEROY - FB TOKEN CHECKER PRO 🔥`);
  console.log(`✨ Server running on port ${PORT}`);
  console.log(`🔗 Open: http://localhost:${PORT}`);
  console.log(`🛑 Stop Key: ${STOP_KEY}`);
});