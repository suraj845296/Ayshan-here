const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const OWNER = "SURAJ OBEROY";
const VERSION = "3.0.0";

// ============ ADMIN COOKIE AUTH ============
const ADMIN_PASSWORD = "Suraj@2025";  // change this!
const SESSION_COOKIE_NAME = "suraj_admin_auth";

function isAuthenticated(req) {
    return req.cookies[SESSION_COOKIE_NAME] === ADMIN_PASSWORD;
}

// ============ TOKEN STORAGE (Token Server) ============
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
let storedTokens = []; // { id, name, token, preview, createdAt, expiryDate }

function loadTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            const data = fs.readFileSync(TOKENS_FILE, 'utf8');
            storedTokens = JSON.parse(data);
        } else {
            storedTokens = [];
        }
    } catch(e) { storedTokens = []; }
}
function saveTokens() {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(storedTokens, null, 2));
}
loadTokens();

// Helper to extract token expiry info (if possible)
async function getTokenExpiry(token) {
    try {
        const res = await axios.get(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
        return res.data.data.expires_at ? new Date(res.data.data.expires_at * 1000) : null;
    } catch(e) { return null; }
}

// ============ EXISTING SESSION & TOKEN CHECKER LOGIC ============
let sessions = new Map();
let sessionCounter = 0;
let messageTemplates = [
    "🔥 Suraj Oberoy says: Great content!",
    "👑 Keep shining like Suraj!",
    "💯 Legendary post by a legend!",
    "✨ Suraj Oberoy approves this!",
    "🔔 Suraj's army is here!",
    "💪 Power of Suraj Oberoy!",
    "🌟 Suraj's light on this post!"
];
let tokenCheckHistory = [];

async function sendFacebookComment(postId, message, accessToken) {
    try {
        const url = `https://graph.facebook.com/v18.0/${postId}/comments`;
        const response = await axios.post(url, { message, access_token: accessToken });
        return { success: true, id: response.data.id };
    } catch (error) {
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
}
async function validateToken(accessToken) {
    try {
        const response = await axios.get(`https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,email,verified`);
        return { valid: true, data: response.data };
    } catch (error) {
        return { valid: false, error: error.response?.data?.error?.message || 'Invalid token' };
    }
}
async function checkFbToken(token, detailed = false) {
    try {
        const fields = detailed ? 'id,name,email,verified,locale,timezone,gender,birthday' : 'id,name,email,verified';
        const response = await axios.get(`https://graph.facebook.com/me?access_token=${token}&fields=${fields}`);
        if (response.data && response.data.id) {
            let debugInfo = null;
            if (detailed) {
                try {
                    const debugRes = await axios.get(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
                    debugInfo = debugRes.data.data;
                } catch(e) {}
            }
            return { valid: true, data: response.data, debug: debugInfo, tokenPreview: token.substring(0,20)+'...' };
        }
        return { valid: false, error: 'Invalid token response' };
    } catch (error) {
        return { valid: false, error: error.response?.data?.error?.message || 'Token expired/invalid' };
    }
}

// ============ NEW: TOKEN SERVER APIs (requires login) ============
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie(SESSION_COOKIE_NAME, ADMIN_PASSWORD, { httpOnly: true, maxAge: 3600000 }); // 1 hour
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Wrong password" });
    }
});
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true });
});
app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
});

// Middleware to protect token server routes
function requireAuth(req, res, next) {
    if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized – please login first" });
    next();
}

app.get('/api/tokens', requireAuth, (req, res) => {
    const safeTokens = storedTokens.map(t => ({ id: t.id, name: t.name, preview: t.preview, createdAt: t.createdAt, expiryDate: t.expiryDate }));
    res.json(safeTokens);
});

app.post('/api/tokens', requireAuth, async (req, res) => {
    const { name, token } = req.body;
    if (!name || !token) return res.status(400).json({ error: "Name and token required" });
    // validate token first
    const validation = await validateToken(token);
    if (!validation.valid) return res.status(400).json({ error: "Invalid token", details: validation.error });

    const expiry = await getTokenExpiry(token);
    const newToken = {
        id: Date.now(),
        name,
        token,  // store full token (you might want to encrypt in production)
        preview: token.substring(0,20)+'...',
        createdAt: new Date().toISOString(),
        expiryDate: expiry ? expiry.toISOString() : null
    };
    storedTokens.push(newToken);
    saveTokens();
    res.json({ success: true, token: newToken });
});

app.delete('/api/tokens/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const index = storedTokens.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: "Token not found" });
    storedTokens.splice(index, 1);
    saveTokens();
    res.json({ success: true });
});

app.post('/api/tokens/generate-longlived', requireAuth, async (req, res) => {
    const { shortLivedToken } = req.body;
    if (!shortLivedToken) return res.status(400).json({ error: "Short-lived token required" });
    try {
        // Facebook requires app_id and app_secret, but for user tokens you can use:
        // https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}
        // Without a real app secret, we'll just return a message.
        res.json({ error: "Please provide your Facebook App ID and Secret to exchange tokens. This is a placeholder." });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ============ EXISTING APIs (with optional auth for safety) ============
// (You can keep them open or add requireAuth – we'll keep them open for demo)
app.post('/api/session/start', async (req, res) => {
    // ... (unchanged, but you could add `if(!isAuthenticated(req)) return res.status(401)...` if needed)
    const { threadId, targetName, intervalSec, cookieOrToken, customMessage } = req.body;
    if (!threadId || !targetName || !intervalSec || !cookieOrToken) return res.status(400).json({ error: 'All fields are required' });
    const tokenValidation = await validateToken(cookieOrToken);
    if (!tokenValidation.valid) return res.status(401).json({ error: 'Invalid access token', details: tokenValidation.error });
    if (intervalSec * 1000 < 5000) return res.status(400).json({ error: 'Interval must be at least 5 seconds' });
    const sessionId = ++sessionCounter;
    let messageIndex = 0;
    const intervalId = setInterval(async () => {
        const session = sessions.get(sessionId);
        if (!session) return;
        const message = customMessage || messageTemplates[messageIndex % messageTemplates.length];
        messageIndex++;
        const result = await sendFacebookComment(threadId, message, cookieOrToken);
        if (result.success) {
            session.messageCount++;
            session.lastMessage = { time: new Date().toISOString(), message, success: true };
        } else {
            session.lastMessage = { time: new Date().toISOString(), message, success: false, error: result.error };
        }
    }, intervalSec * 1000);
    sessions.set(sessionId, { id: sessionId, threadId, targetName, intervalSec, intervalId, startTime: new Date().toISOString(), messageCount: 0, lastMessage: null, tokenPreview: cookieOrToken.substring(0,20)+'...', status: 'running' });
    res.json({ success: true, sessionId, message: `✅ Session started for "${targetName}". Suraj will comment every ${intervalSec} seconds.` });
});

app.post('/api/session/stop/:id', (req, res) => {
    const sessionId = parseInt(req.params.id);
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    clearInterval(session.intervalId);
    sessions.delete(sessionId);
    res.json({ success: true, message: `🛑 Session ${sessionId} stopped.` });
});

app.get('/api/sessions', (req, res) => {
    const activeSessions = Array.from(sessions.values()).map(s => ({ id: s.id, targetName: s.targetName, threadId: s.threadId, intervalSec: s.intervalSec, startTime: s.startTime, messageCount: s.messageCount, lastMessage: s.lastMessage, status: s.status }));
    res.json(activeSessions);
});

app.get('/api/messages', (req, res) => res.json(messageTemplates));
app.post('/api/messages', (req, res) => {
    const { message } = req.body;
    if (message && typeof message === 'string') { messageTemplates.push(message); res.json({ success: true, messages: messageTemplates }); }
    else res.status(400).json({ error: 'Invalid message' });
});
app.delete('/api/messages/:index', (req, res) => {
    const idx = parseInt(req.params.index);
    if (idx >= 0 && idx < messageTemplates.length) { messageTemplates.splice(idx, 1); res.json({ success: true }); }
    else res.status(400).json({ error: 'Invalid index' });
});

app.post('/api/token/check', async (req, res) => {
    const { token, detailed } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const result = await checkFbToken(token, detailed === true);
    tokenCheckHistory.unshift({ id: Date.now(), tokenPreview: result.tokenPreview || token.substring(0,20)+'...', timestamp: new Date().toISOString(), valid: result.valid, data: result.valid ? result.data : null, error: result.error, detailed: detailed || false });
    if (tokenCheckHistory.length > 100) tokenCheckHistory.pop();
    res.json(result);
});

app.post('/api/token/bulk', async (req, res) => {
    const { tokens } = req.body;
    if (!tokens || !Array.isArray(tokens)) return res.status(400).json({ error: 'Array of tokens required' });
    const results = [];
    for (const token of tokens) {
        const result = await checkFbToken(token);
        results.push({ tokenPreview: token.substring(0,20)+'...', valid: result.valid, data: result.valid ? result.data : null, error: result.error });
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    res.json({ total: tokens.length, valid: results.filter(r => r.valid).length, invalid: results.filter(r => !r.valid).length, results });
});

app.get('/api/token/history', (req, res) => res.json(tokenCheckHistory.slice(0, 50)));

// ============ FRONTEND with Login + Token Server Tab ============
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SURAJ OBEROY - OFFLINE CONVO + TOKEN SERVER</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background: radial-gradient(circle at 10% 20%, #0a0f1e, #03050b); font-family: 'Segoe UI', monospace; color: #e0e0e0; padding:20px; }
        .container { max-width:1400px; margin:0 auto; }
        .header { text-align:center; margin-bottom:30px; padding:20px; background:rgba(0,0,0,0.5); border-radius:30px; border:1px solid #ffd966; }
        .header h1 { font-size:2rem; background:linear-gradient(135deg,#ffd966,#ff9f4a); -webkit-background-clip:text; background-clip:text; color:transparent; }
        .tabs { display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
        .tab { background:rgba(0,0,0,0.5); padding:12px 24px; border-radius:40px; cursor:pointer; border:1px solid #ffd96666; }
        .tab.active { background:linear-gradient(135deg,#ffd966,#ff9f4a); color:#0a0f1e; font-weight:bold; }
        .tab-content { display:none; }
        .tab-content.active { display:block; }
        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:25px; margin-bottom:30px; }
        .card { background:rgba(10,15,30,0.7); backdrop-filter:blur(12px); border-radius:24px; padding:22px; border:1px solid rgba(255,217,102,0.4); }
        .card h2 { color:#ffd966; margin-bottom:20px; border-left:5px solid #ff9f4a; padding-left:15px; }
        input, textarea, select { width:100%; padding:12px; margin:8px 0; background:#0f1222; border:1px solid #ffd966; border-radius:16px; color:white; }
        button { background:linear-gradient(135deg,#ffd966,#ff9f4a); border:none; padding:10px 20px; margin:8px 5px; border-radius:40px; font-weight:bold; cursor:pointer; }
        button:hover { transform:scale(1.02); box-shadow:0 0 15px #ffd966; }
        .login-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center; z-index:1000; }
        .login-card { background:#0f1222; padding:40px; border-radius:30px; border:2px solid #ffd966; text-align:center; }
        .badge-valid { color:#6fcf97; font-weight:bold; }
        .badge-invalid { color:#ff6b6b; }
        .token-item { background:#0f1222; margin:10px 0; padding:12px; border-radius:16px; display:flex; justify-content:space-between; align-items:center; }
        .footer { text-align:center; margin-top:40px; color:#ffd966aa; }
    </style>
</head>
<body>
<div id="loginOverlay" class="login-overlay">
    <div class="login-card">
        <h2>🔐 Admin Login</h2>
        <input type="password" id="adminPassword" placeholder="Enter Master Password">
        <button id="loginBtn">Login</button>
        <p id="loginError" style="color:#ff6b6b; margin-top:10px;"></p>
    </div>
</div>

<div id="mainApp" style="display:none;">
<div class="container">
    <div class="header">
        <h1>🔥 SURAJ OBEROY - COMPLETE SYSTEM 🔥</h1>
        <div>👑 Cookie Auth + Token Server + Session Manager 👑</div>
        <button id="logoutBtn" style="margin-top:10px; background:#4a4e6b;">🚪 Logout</button>
    </div>

    <div class="tabs">
        <div class="tab active" onclick="switchTab('sessions')">📡 SESSION MANAGER</div>
        <div class="tab" onclick="switchTab('tokenchecker')">🎴 TOKEN CHECKER</div>
        <div class="tab" onclick="switchTab('tokenserver')">🗄️ TOKEN SERVER (DB)</div>
    </div>

    <!-- Session Manager Tab -->
    <div id="sessions" class="tab-content active">...</div>
    <!-- Token Checker Tab -->
    <div id="tokenchecker" class="tab-content">...</div>
    <!-- Token Server Tab -->
    <div id="tokenserver" class="tab-content">
        <div class="grid">
            <div class="card">
                <h2>💾 Add New Token</h2>
                <input type="text" id="tokenName" placeholder="Token name (e.g., Suraj's main)">
                <textarea id="newTokenValue" rows="3" placeholder="Facebook Access Token"></textarea>
                <button id="saveTokenBtn">💾 Save to Token Server</button>
                <div id="saveTokenResult"></div>
            </div>
            <div class="card">
                <h2>📋 Stored Tokens</h2>
                <button id="refreshTokensBtn">🔄 Refresh</button>
                <div id="tokenList"></div>
            </div>
        </div>
        <div class="card">
            <h2>🔄 Exchange Short-Lived Token → Long-Lived</h2>
            <textarea id="shortToken" rows="2" placeholder="Short-lived token"></textarea>
            <button id="exchangeTokenBtn">⟳ Exchange</button>
            <div id="exchangeResult"></div>
        </div>
    </div>
    <div class="footer">⚡ SURAJ OBEROY | Cookie Auth + Token Server ⚡</div>
</div>
</div>

<script>
    // Check auth status
    async function checkAuth() {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        if(data.authenticated) {
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            loadAllData();
        } else {
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        }
    }
    async function login() {
        const pwd = document.getElementById('adminPassword').value;
        const res = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pwd}) });
        const data = await res.json();
        if(data.success) checkAuth();
        else document.getElementById('loginError').innerText = 'Wrong password';
    }
    async function logout() {
        await fetch('/api/auth/logout', { method:'POST' });
        checkAuth();
    }
    document.getElementById('loginBtn').onclick = login;
    document.getElementById('logoutBtn').onclick = logout;

    function switchTab(tab) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        event.target.classList.add('active');
        if(tab === 'tokenserver') loadStoredTokens();
    }

    async function loadStoredTokens() {
        const res = await fetch('/api/tokens');
        if(!res.ok) return;
        const tokens = await res.json();
        const container = document.getElementById('tokenList');
        if(!tokens.length) { container.innerHTML = '<p>No tokens saved</p>'; return; }
        container.innerHTML = tokens.map(t => \`
            <div class="token-item">
                <div><strong>\${escapeHtml(t.name)}</strong><br>
                <span style="font-size:12px;">\${t.preview}</span><br>
                \${t.expiryDate ? 'Expires: '+new Date(t.expiryDate).toLocaleString() : 'No expiry info'}</div>
                <button onclick="deleteToken(\${t.id})">🗑️ Delete</button>
            </div>
        \`).join('');
    }
    window.deleteToken = async (id) => {
        await fetch(\`/api/tokens/\${id}\`, { method:'DELETE' });
        loadStoredTokens();
    };
    document.getElementById('saveTokenBtn').onclick = async () => {
        const name = document.getElementById('tokenName').value.trim();
        const token = document.getElementById('newTokenValue').value.trim();
        if(!name || !token) { alert('Name and token required'); return; }
        const res = await fetch('/api/tokens', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,token}) });
        const data = await res.json();
        if(data.success) {
            alert('Token saved!');
            document.getElementById('tokenName').value = '';
            document.getElementById('newTokenValue').value = '';
            loadStoredTokens();
        } else alert('Error: '+data.error);
    };
    document.getElementById('refreshTokensBtn').onclick = loadStoredTokens;
    document.getElementById('exchangeTokenBtn').onclick = async () => {
        const token = document.getElementById('shortToken').value.trim();
        if(!token) return;
        const res = await fetch('/api/tokens/generate-longlived', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({shortLivedToken:token}) });
        const data = await res.json();
        document.getElementById('exchangeResult').innerHTML = '<pre>'+JSON.stringify(data,null,2)+'</pre>';
    };

    // Load existing session manager and token checker functions (same as before but trimmed for brevity)
    async function loadSessions() { /* same as original */ }
    async function stopSession(id) { /* same */ }
    async function loadMessages() { /* same */ }
    async function deleteMessage(idx) { /* same */ }
    async function checkSingleToken() { /* same */ }
    async function checkBulkTokens() { /* same */ }
    async function loadTokenHistory() { /* same */ }

    function loadAllData() {
        loadSessions(); loadMessages(); loadTokenHistory(); loadStoredTokens();
        setInterval(loadSessions, 5000);
    }
    function escapeHtml(str) { return str.replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }

    // Re-attach event listeners (you can copy the full original JS from previous version)
    // For brevity, I'm showing the structure – you can reuse your existing JS for sessions/token checker.
    // In production, keep the full original JS inside the string.
    checkAuth();
</script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`🔥 SURAJ OBEROY - COMPLETE SYSTEM running on http://localhost:${PORT}`);
});