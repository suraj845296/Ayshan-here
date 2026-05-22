const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const OWNER = "SURAJ OBEROY";
const VERSION = "3.0.0";

// ============ SESSION MANAGER DATA ============
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

// ============ TOKEN CHECKER DATA ============
let tokenCheckHistory = [];  // store last 100 checks

// ============ FACEBOOK API HELPERS ============
async function sendFacebookComment(postId, message, accessToken) {
    try {
        const url = `https://graph.facebook.com/v18.0/${postId}/comments`;
        const response = await axios.post(url, {
            message: message,
            access_token: accessToken
        });
        return { success: true, id: response.data.id };
    } catch (error) {
        let errorMsg = error.response?.data?.error?.message || error.message;
        return { success: false, error: errorMsg };
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

// ============ TOKEN CHECKER FUNCTION ============
async function checkFbToken(token, detailed = false) {
    try {
        const fields = detailed ? 'id,name,email,verified,locale,timezone,gender,birthday' : 'id,name,email,verified';
        const response = await axios.get(`https://graph.facebook.com/me?access_token=${token}&fields=${fields}`);
        if (response.data && response.data.id) {
            // Get token debug info
            let debugInfo = null;
            if (detailed) {
                try {
                    const debugRes = await axios.get(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
                    debugInfo = debugRes.data.data;
                } catch(e) {}
            }
            return { 
                valid: true, 
                data: response.data,
                debug: debugInfo,
                tokenPreview: token.substring(0, 20) + '...'
            };
        }
        return { valid: false, error: 'Invalid token response' };
    } catch (error) {
        return { valid: false, error: error.response?.data?.error?.message || 'Token expired/invalid' };
    }
}

// ============ SESSION MANAGER APIs ============

// Start a new session
app.post('/api/session/start', async (req, res) => {
    const { threadId, targetName, intervalSec, cookieOrToken, customMessage } = req.body;

    if (!threadId || !targetName || !intervalSec || !cookieOrToken) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const tokenValidation = await validateToken(cookieOrToken);
    if (!tokenValidation.valid) {
        return res.status(401).json({ error: 'Invalid access token', details: tokenValidation.error });
    }

    const intervalMs = intervalSec * 1000;
    if (intervalMs < 5000) {
        return res.status(400).json({ error: 'Interval must be at least 5 seconds' });
    }

    const sessionId = ++sessionCounter;
    let messageIndex = 0;

    const intervalId = setInterval(async () => {
        const session = sessions.get(sessionId);
        if (!session) return;

        const message = customMessage || messageTemplates[messageIndex % messageTemplates.length];
        messageIndex++;

        console.log(`[Suraj Session ${sessionId}] ➤ Posting to ${targetName} (${threadId}): ${message}`);

        const result = await sendFacebookComment(threadId, message, cookieOrToken);
        if (result.success) {
            session.messageCount++;
            session.lastMessage = { time: new Date().toISOString(), message, success: true };
            console.log(`[Suraj Session ${sessionId}] ✅ Message sent. Total: ${session.messageCount}`);
        } else {
            session.lastMessage = { time: new Date().toISOString(), message, success: false, error: result.error };
            console.error(`[Suraj Session ${sessionId}] ❌ Failed: ${result.error}`);
        }
    }, intervalMs);

    const sessionData = {
        id: sessionId,
        threadId,
        targetName,
        intervalSec,
        intervalId,
        startTime: new Date().toISOString(),
        messageCount: 0,
        lastMessage: null,
        tokenPreview: cookieOrToken.substring(0, 20) + '...',
        status: 'running'
    };

    sessions.set(sessionId, sessionData);

    res.json({
        success: true,
        sessionId,
        message: `✅ Session started for "${targetName}". Suraj will comment every ${intervalSec} seconds.`
    });
});

// Stop a session
app.post('/api/session/stop/:id', (req, res) => {
    const sessionId = parseInt(req.params.id);
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    clearInterval(session.intervalId);
    session.status = 'stopped';
    sessions.delete(sessionId);

    res.json({ success: true, message: `🛑 Session ${sessionId} stopped by Suraj Oberoy.` });
});

// Get all active sessions
app.get('/api/sessions', (req, res) => {
    const activeSessions = Array.from(sessions.values()).map(s => ({
        id: s.id,
        targetName: s.targetName,
        threadId: s.threadId,
        intervalSec: s.intervalSec,
        startTime: s.startTime,
        messageCount: s.messageCount,
        lastMessage: s.lastMessage,
        status: s.status
    }));
    res.json(activeSessions);
});

// Message templates CRUD
app.get('/api/messages', (req, res) => {
    res.json(messageTemplates);
});

app.post('/api/messages', (req, res) => {
    const { message } = req.body;
    if (message && typeof message === 'string') {
        messageTemplates.push(message);
        res.json({ success: true, messages: messageTemplates });
    } else {
        res.status(400).json({ error: 'Invalid message' });
    }
});

app.delete('/api/messages/:index', (req, res) => {
    const idx = parseInt(req.params.index);
    if (idx >= 0 && idx < messageTemplates.length) {
        messageTemplates.splice(idx, 1);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid index' });
    }
});

// ============ TOKEN CHECKER APIs ============

// Single token check
app.post('/api/token/check', async (req, res) => {
    const { token, detailed } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const result = await checkFbToken(token, detailed === true);
    
    // Save to history
    tokenCheckHistory.unshift({
        id: Date.now(),
        tokenPreview: result.tokenPreview || token.substring(0,20)+'...',
        timestamp: new Date().toISOString(),
        valid: result.valid,
        data: result.valid ? result.data : null,
        error: result.error,
        detailed: detailed || false
    });
    if (tokenCheckHistory.length > 100) tokenCheckHistory.pop();

    res.json(result);
});

// Bulk token check
app.post('/api/token/bulk', async (req, res) => {
    const { tokens } = req.body;
    if (!tokens || !Array.isArray(tokens)) {
        return res.status(400).json({ error: 'Array of tokens required' });
    }

    const results = [];
    for (const token of tokens) {
        const result = await checkFbToken(token);
        results.push({
            tokenPreview: token.substring(0, 20) + '...',
            valid: result.valid,
            data: result.valid ? result.data : null,
            error: result.error
        });
        // small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    res.json({
        total: tokens.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        results
    });
});

// Get token check history
app.get('/api/token/history', (req, res) => {
    res.json(tokenCheckHistory.slice(0, 50));
});

// ============ FRONTEND UI (with Token Checker Tab) ============
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SURAJ OBEROY - OFFLINE CONVO + TOKEN CHECKER</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: radial-gradient(circle at 10% 20%, #0a0f1e, #03050b);
            font-family: 'Segoe UI', 'Courier New', monospace;
            color: #e0e0e0;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: rgba(0,0,0,0.5);
            border-radius: 30px;
            border: 1px solid #ffd966;
            backdrop-filter: blur(10px);
        }
        .header h1 {
            font-size: 2rem;
            background: linear-gradient(135deg, #ffd966, #ff9f4a);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        .owner-tag {
            color: #ff9f4a;
            margin-top: 8px;
        }

        /* Tabs */
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .tab {
            background: rgba(0,0,0,0.5);
            padding: 12px 24px;
            border-radius: 40px;
            cursor: pointer;
            transition: 0.3s;
            border: 1px solid #ffd96666;
        }
        .tab.active {
            background: linear-gradient(135deg, #ffd966, #ff9f4a);
            color: #0a0f1e;
            font-weight: bold;
            border-color: transparent;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }

        /* Cards */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }
        .card {
            background: rgba(10, 15, 30, 0.7);
            backdrop-filter: blur(12px);
            border-radius: 24px;
            padding: 22px;
            border: 1px solid rgba(255, 217, 102, 0.4);
            transition: 0.3s;
        }
        .card:hover {
            border-color: #ffd966;
            box-shadow: 0 0 25px rgba(255, 217, 102, 0.2);
        }
        .card h2 {
            color: #ffd966;
            margin-bottom: 20px;
            font-size: 1.4rem;
            border-left: 5px solid #ff9f4a;
            padding-left: 15px;
        }
        input, textarea, select {
            width: 100%;
            padding: 12px;
            margin: 8px 0;
            background: #0f1222;
            border: 1px solid #ffd966;
            border-radius: 16px;
            color: white;
            font-family: monospace;
        }
        button {
            background: linear-gradient(135deg, #ffd966, #ff9f4a);
            border: none;
            padding: 10px 20px;
            margin: 8px 5px;
            border-radius: 40px;
            font-weight: bold;
            cursor: pointer;
            transition: 0.2s;
            color: #0a0f1e;
        }
        button:hover {
            transform: scale(1.02);
            box-shadow: 0 0 15px #ffd966;
        }
        .btn-stop {
            background: linear-gradient(135deg, #4a4e6b, #2a2e4a);
            color: #ffd966;
        }
        .session-list, .history-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .session-item, .history-item {
            background: #0f1222;
            border-left: 4px solid #ffd966;
            margin: 12px 0;
            padding: 12px;
            border-radius: 16px;
        }
        .status-running { color: #6fcf97; }
        .badge-valid { color: #6fcf97; font-weight: bold; }
        .badge-invalid { color: #ff6b6b; font-weight: bold; }
        .message-template {
            background: #0f1222;
            padding: 10px;
            margin: 8px 0;
            display: flex;
            justify-content: space-between;
            border-radius: 14px;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            padding: 15px;
            color: #ffd966aa;
            border-top: 1px solid #ffd96633;
        }
        @media (max-width: 700px) {
            .grid { grid-template-columns: 1fr; }
            .header h1 { font-size: 1.2rem; }
            .tab { padding: 8px 16px; font-size: 0.8rem; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>🔥 SURAJ OBEROY - OFFLINE CONVO + TOKEN CHECKER 🔥</h1>
        <div class="owner-tag">👑 OWNER: SURAJ OBEROY | SESSION MANAGER | TOKEN VALIDATOR 👑</div>
    </div>

    <!-- TABS -->
    <div class="tabs">
        <div class="tab active" onclick="switchTab('sessions')">📡 SESSION MANAGER</div>
        <div class="tab" onclick="switchTab('tokenchecker')">🎴 TOKEN CHECKER</div>
    </div>

    <!-- TAB 1: SESSION MANAGER -->
    <div id="sessions" class="tab-content active">
        <div class="grid">
            <div class="card">
                <h2>🚀 START NEW SESSION</h2>
                <label>TARGET THREAD ID</label>
                <input type="text" id="threadId" placeholder="Facebook Post ID">
                <label>TARGET NAME</label>
                <input type="text" id="targetName" placeholder="Enter target name">
                <label>INTERVAL (SECONDS)</label>
                <input type="number" id="interval" value="60" min="10">
                <label>ACCESS TOKEN</label>
                <textarea id="tokenCookie" rows="2" placeholder="Facebook Access Token"></textarea>
                <label>CUSTOM MESSAGE (optional)</label>
                <input type="text" id="customMsg" placeholder="Leave blank to rotate">
                <button id="startBtn">▶️ START SESSION</button>
                <div id="startResult"></div>
            </div>
            <div class="card">
                <h2>📋 ACTIVE SESSIONS</h2>
                <div id="activeSessions" class="session-list"><p>No active sessions</p></div>
                <button id="refreshSessionsBtn">🔄 REFRESH</button>
            </div>
        </div>
        <div class="card">
            <h2>💬 MESSAGE TEMPLATES (ROTATING)</h2>
            <div id="messageList"></div>
            <div style="display:flex; gap:10px;">
                <input type="text" id="newMessage" placeholder="New template">
                <button id="addMsgBtn">➕ ADD</button>
            </div>
        </div>
    </div>

    <!-- TAB 2: TOKEN CHECKER -->
    <div id="tokenchecker" class="tab-content">
        <div class="grid">
            <div class="card">
                <h2>🎯 SINGLE TOKEN CHECK</h2>
                <textarea id="singleToken" rows="3" placeholder="Paste Facebook Access Token"></textarea>
                <label><input type="checkbox" id="detailedCheck"> Get detailed info (locale, timezone, etc.)</label>
                <button id="checkSingleBtn">🔍 CHECK TOKEN</button>
                <div id="singleResult"></div>
            </div>
            <div class="card">
                <h2>📦 BULK TOKEN CHECK</h2>
                <textarea id="bulkTokens" rows="5" placeholder="Paste multiple tokens (one per line)"></textarea>
                <button id="checkBulkBtn">📊 BULK CHECK</button>
                <div id="bulkResult"></div>
            </div>
        </div>
        <div class="card">
            <h2>📜 CHECK HISTORY (Last 50)</h2>
            <button id="refreshHistoryBtn">🔄 REFRESH HISTORY</button>
            <div id="tokenHistory" class="history-list"></div>
        </div>
    </div>

    <div class="footer">⚡ SURAJ OBEROY | OFFLINE SESSION MANAGER + FB TOKEN VALIDATOR ⚡</div>
</div>

<script>
    // ============ TAB SWITCHING ============
    function switchTab(tab) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        event.target.classList.add('active');
        if (tab === 'tokenchecker') loadTokenHistory();
    }

    // ============ SESSION MANAGER FUNCTIONS ============
    async function loadSessions() {
        const res = await fetch('/api/sessions');
        const sessions = await res.json();
        const container = document.getElementById('activeSessions');
        if (!sessions.length) { container.innerHTML = '<p>No active sessions</p>'; return; }
        container.innerHTML = sessions.map(s => \`
            <div class="session-item">
                <div><strong>🎯 \${escapeHtml(s.targetName)}</strong> <span class="status-running">● RUNNING</span></div>
                <div>🆔 Thread: \${escapeHtml(s.threadId)}</div>
                <div>⏱️ Interval: \${s.intervalSec} sec | 💬 Msgs: \${s.messageCount}</div>
                <div>🕒 Started: \${new Date(s.startTime).toLocaleString()}</div>
                \${s.lastMessage ? \`<div>📨 Last: \${s.lastMessage.success ? '✅' : '❌'} "\${escapeHtml(s.lastMessage.message.substring(0,50))}"</div>\` : ''}
                <button class="btn-stop" onclick="stopSession(\${s.id})">🛑 STOP</button>
            </div>
        \`).join('');
    }

    async function stopSession(id) {
        const res = await fetch(\`/api/session/stop/\${id}\`, { method: 'POST' });
        const data = await res.json();
        if (data.success) alert(\`✅ Session \${id} stopped.\`);
        loadSessions();
    }

    document.getElementById('startBtn').onclick = async () => {
        const threadId = document.getElementById('threadId').value.trim();
        const targetName = document.getElementById('targetName').value.trim();
        const intervalSec = parseInt(document.getElementById('interval').value);
        const token = document.getElementById('tokenCookie').value.trim();
        const customMsg = document.getElementById('customMsg').value.trim();

        if (!threadId || !targetName || !intervalSec || !token) {
            alert('Fill all required fields!'); return;
        }
        if (intervalSec < 5) { alert('Min interval 5 sec'); return; }

        const btn = document.getElementById('startBtn');
        btn.disabled = true;
        btn.innerText = 'STARTING...';
        document.getElementById('startResult').innerHTML = '';

        const res = await fetch('/api/session/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threadId, targetName, intervalSec, cookieOrToken: token, customMessage: customMsg || null })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('startResult').innerHTML = \`<span style="color:#6fcf97;">✅ \${data.message}</span>\`;
            document.getElementById('threadId').value = '';
            document.getElementById('targetName').value = '';
            document.getElementById('interval').value = '60';
            document.getElementById('customMsg').value = '';
            loadSessions();
        } else {
            document.getElementById('startResult').innerHTML = \`<span style="color:#ff6b6b;">❌ \${data.error} - \${data.details || ''}</span>\`;
        }
        btn.disabled = false;
        btn.innerText = '▶️ START SESSION';
    };

    document.getElementById('refreshSessionsBtn').onclick = () => loadSessions();

    // Message templates
    async function loadMessages() {
        const res = await fetch('/api/messages');
        const msgs = await res.json();
        const container = document.getElementById('messageList');
        if (!msgs.length) { container.innerHTML = '<p>No messages</p>'; return; }
        container.innerHTML = msgs.map((msg, idx) => \`
            <div class="message-template">
                <span>💬 \${escapeHtml(msg)}</span>
                <button class="btn-stop" onclick="deleteMessage(\${idx})">🗑️</button>
            </div>
        \`).join('');
    }

    window.deleteMessage = async (idx) => {
        await fetch(\`/api/messages/\${idx}\`, { method: 'DELETE' });
        loadMessages();
    };

    document.getElementById('addMsgBtn').onclick = async () => {
        const newMsg = document.getElementById('newMessage').value.trim();
        if (!newMsg) return;
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: newMsg })
        });
        document.getElementById('newMessage').value = '';
        loadMessages();
    };

    // ============ TOKEN CHECKER FUNCTIONS ============
    async function checkSingleToken() {
        const token = document.getElementById('singleToken').value.trim();
        if (!token) { alert('Paste a token!'); return; }
        const detailed = document.getElementById('detailedCheck').checked;
        const resultDiv = document.getElementById('singleResult');
        resultDiv.innerHTML = 'Checking...';

        const res = await fetch('/api/token/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, detailed })
        });
        const data = await res.json();
        if (data.valid) {
            resultDiv.innerHTML = \`
                <div style="background:#1e3a2a; padding:12px; border-radius:16px; margin-top:10px;">
                    <span class="badge-valid">✅ VALID TOKEN</span><br>
                    <strong>Name:</strong> \${escapeHtml(data.data.name)}<br>
                    <strong>ID:</strong> \${data.data.id}<br>
                    <strong>Email:</strong> \${data.data.email || 'N/A'}<br>
                    <strong>Verified:</strong> \${data.data.verified ? 'Yes' : 'No'}<br>
                    \${detailed && data.debug ? \`<strong>App ID:</strong> \${data.debug.app_id}<br><strong>Expires:</strong> \${new Date(data.debug.expires_at * 1000).toLocaleString()}\` : ''}
                </div>
            \`;
        } else {
            resultDiv.innerHTML = \`<div style="background:#3a1e1e; padding:12px; border-radius:16px; margin-top:10px;"><span class="badge-invalid">❌ INVALID</span><br>Error: \${escapeHtml(data.error)}</div>\`;
        }
        loadTokenHistory();
    }

    async function checkBulkTokens() {
        const tokensText = document.getElementById('bulkTokens').value;
        const tokens = tokensText.split('\\n').filter(t => t.trim().length > 0);
        if (!tokens.length) { alert('Enter at least one token'); return; }
        const resultDiv = document.getElementById('bulkResult');
        resultDiv.innerHTML = 'Checking ' + tokens.length + ' tokens...';

        const res = await fetch('/api/token/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokens })
        });
        const data = await res.json();
        let html = \`<div style="margin-top:10px;"><strong>Total: \${data.total} | Valid: \${data.valid} | Invalid: \${data.invalid}</strong><br><br>\`;
        data.results.forEach(r => {
            html += \`<div style="padding:6px; margin:4px 0; background:#0f1222; border-radius:12px;">\${r.valid ? '✅' : '❌'} \${r.tokenPreview} \${r.valid ? '- ' + (r.data?.name || '') : '- ' + (r.error || '')}</div>\`;
        });
        html += '</div>';
        resultDiv.innerHTML = html;
        loadTokenHistory();
    }

    async function loadTokenHistory() {
        const res = await fetch('/api/token/history');
        const history = await res.json();
        const container = document.getElementById('tokenHistory');
        if (!history.length) { container.innerHTML = '<p>No checks yet</p>'; return; }
        container.innerHTML = history.map(h => \`
            <div class="history-item">
                <div><span class="\${h.valid ? 'badge-valid' : 'badge-invalid'}">\${h.valid ? '✅ VALID' : '❌ INVALID'}</span> <span style="color:#aaa;">\${new Date(h.timestamp).toLocaleString()}</span></div>
                <div>Token: \${escapeHtml(h.tokenPreview)}</div>
                \${h.valid ? \`<div>Name: \${escapeHtml(h.data?.name)} | ID: \${h.data?.id}</div>\` : \`<div>Error: \${escapeHtml(h.error)}</div>\`}
            </div>
        \`).join('');
    }

    document.getElementById('checkSingleBtn').onclick = checkSingleToken;
    document.getElementById('checkBulkBtn').onclick = checkBulkTokens;
    document.getElementById('refreshHistoryBtn').onclick = loadTokenHistory;

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // Initial loads
    loadSessions();
    loadMessages();
    loadTokenHistory();
    setInterval(loadSessions, 5000);
</script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════╗
    ║  🔥 SURAJ OBEROY - COMPLETE SYSTEM 🔥                ║
    ║  🚀 Session Manager + Token Checker                  ║
    ║  🌐 http://localhost:${PORT}                          ║
    ║  👑 Owner: SURAJ OBEROY                              ║
    ╚══════════════════════════════════════════════════════╝
    `);
});