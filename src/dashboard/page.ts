/** Returns the full HTML for the admin dashboard (single-page app). */
export function dashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cal-Sync Dashboard</title>
<style>
  :root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--green:#4ade80;--yellow:#facc15;--red:#f87171;--font:system-ui,-apple-system,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--font);padding:20px;max-width:1100px;margin:0 auto;font-size:14px}
  h1{font-size:1.5rem;margin-bottom:4px}
  .subtitle{color:var(--muted);margin-bottom:24px;font-size:.85rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  @media(max-width:700px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px}
  .card h2{font-size:.9rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.75rem;font-weight:600}
  .badge-ok{background:#065f46;color:var(--green)}
  .badge-warn{background:#713f12;color:var(--yellow)}
  .badge-err{background:#7f1d1d;color:var(--red)}
  .badge-off{background:#374151;color:var(--muted)}
  .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
  .kv:last-child{border-bottom:none}
  .kv .k{color:var(--muted)}
  .kv .v{font-family:monospace;font-size:.85rem}
  table{width:100%;border-collapse:collapse;font-size:.82rem}
  th{text-align:left;color:var(--muted);font-weight:500;padding:8px 6px;border-bottom:1px solid var(--border)}
  td{padding:8px 6px;border-bottom:1px solid var(--border);font-family:monospace;word-break:break-all}
  .full{grid-column:1/-1}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  button{background:var(--accent);color:#0f172a;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:.82rem;font-weight:600;transition:opacity .15s}
  button:hover{opacity:.85}
  button:disabled{opacity:.5;cursor:not-allowed}
  button.danger{background:var(--red)}
  .toast{position:fixed;bottom:24px;right:24px;background:var(--card);border:1px solid var(--border);padding:12px 20px;border-radius:8px;font-size:.85rem;opacity:0;transition:opacity .3s;pointer-events:none;z-index:100}
  .toast.show{opacity:1}
  .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .empty{color:var(--muted);padding:16px 0;text-align:center;font-style:italic}
  .refresh-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .refresh-row button{background:transparent;color:var(--accent);border:1px solid var(--accent);font-weight:500}
  .time-ago{color:var(--muted);font-size:.8rem}
</style>
</head>
<body>

<h1>Cal-Sync Dashboard</h1>
<p class="subtitle">Google Calendar &harr; LINE WORKS Calendar</p>

<div class="refresh-row">
  <span class="time-ago" id="lastRefresh"></span>
  <button onclick="loadAll()">Refresh</button>
</div>

<!-- Status + Watch -->
<div class="grid">
  <div class="card" id="statusCard">
    <h2>Service Status</h2>
    <div id="statusBody"><div class="empty"><span class="spinner"></span> Loading...</div></div>
  </div>
  <div class="card" id="watchCard">
    <h2>Google Watch Channel</h2>
    <div id="watchBody"><div class="empty"><span class="spinner"></span> Loading...</div></div>
  </div>
</div>

<!-- Users -->
<div class="card" style="margin-bottom:16px" id="usersCard">
  <h2>User Configs</h2>
  <div id="usersBody"><div class="empty"><span class="spinner"></span> Loading...</div></div>
</div>

<!-- Mappings -->
<div class="card" style="margin-bottom:16px" id="mappingsCard">
  <h2>Event Mappings</h2>
  <div id="mappingsBody"><div class="empty"><span class="spinner"></span> Loading...</div></div>
</div>

<!-- Errors -->
<div class="card" style="margin-bottom:16px" id="errorsCard">
  <h2>Error Queue</h2>
  <div id="errorsBody"><div class="empty"><span class="spinner"></span> Loading...</div></div>
</div>

<!-- Actions -->
<div class="card">
  <h2>Actions</h2>
  <div class="actions">
    <button onclick="triggerPoll()" id="btnPoll">Trigger Poll</button>
    <button onclick="triggerInitialSync()" id="btnInitSync">Initial Sync</button>
    <button onclick="triggerWatchRenew()" id="btnWatchRenew">Renew Watch</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = '/dashboard/api';
let currentUserId = null;

function $(id){ return document.getElementById(id); }

function toast(msg, ms){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), ms || 3000);
}

function kv(label, value){
  return '<div class="kv"><span class="k">'+esc(label)+'</span><span class="v">'+esc(String(value))+'</span></div>';
}

function esc(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function badge(text, cls){
  return '<span class="badge badge-'+cls+'">'+esc(text)+'</span>';
}

function fmtUptime(s){
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  return (d?d+'d ':'')+(h?h+'h ':'')+(m?m+'m':'<1m');
}

function relTime(iso){
  if(!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff/60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins+'m ago';
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return hrs+'h ago';
  return Math.floor(hrs/24)+'d ago';
}

async function api(path){
  const r = await fetch(API + path);
  return r.json();
}

async function loadStatus(){
  try{
    const d = await api('/status');
    $('statusBody').innerHTML =
      kv('Status', d.status) +
      kv('Uptime', fmtUptime(d.uptime)) +
      kv('User ID', d.env.syncUserId) +
      kv('Firestore Project', d.env.firestoreProject) +
      kv('Port', d.env.port);
    currentUserId = currentUserId || d.env.syncUserId;
  }catch(e){
    $('statusBody').innerHTML = '<div class="empty">Failed to load status</div>';
  }
}

async function loadUsers(){
  try{
    const users = await api('/users');
    if(!users.length){
      $('usersBody').innerHTML = '<div class="empty">No users configured</div>';
      return;
    }
    let html = '<table><tr><th>User ID</th><th>Google Cal</th><th>LW Cal</th><th>Google Token</th><th>LW Token</th></tr>';
    for(const u of users){
      html += '<tr>'
        +'<td>'+esc(u.userId)+'</td>'
        +'<td>'+esc(u.googleCalendarId)+'</td>'
        +'<td>'+esc(u.lineworksCalendarId)+'</td>'
        +'<td>'+(u.hasGoogleToken ? badge('OK','ok') : badge('Missing','err'))+'</td>'
        +'<td>'+(u.hasLineworksToken ? badge('OK','ok') : badge('Missing','err'))+'</td>'
        +'</tr>';
      if(!currentUserId) currentUserId = u.userId;
    }
    html += '</table>';
    $('usersBody').innerHTML = html;
  }catch(e){
    $('usersBody').innerHTML = '<div class="empty">Failed to load users</div>';
  }
}

async function loadWatch(){
  if(!currentUserId){
    $('watchBody').innerHTML = '<div class="empty">No user ID</div>';
    return;
  }
  try{
    const d = await api('/watch/'+encodeURIComponent(currentUserId));
    if(!d.active && !d.channelId){
      $('watchBody').innerHTML = '<div class="empty">No watch channel configured</div>';
      return;
    }
    const status = d.active
      ? (d.hoursLeft > 24 ? badge('Active','ok') : badge('Expiring soon','warn'))
      : badge('Expired','err');
    $('watchBody').innerHTML =
      kv('Status', '') + // placeholder replaced below
      kv('Channel ID', d.channelId || '-') +
      kv('Expires', d.expiration ? new Date(d.expiration).toLocaleString() : '-') +
      kv('Hours Left', d.hoursLeft ?? '-') +
      kv('Webhook URL', d.webhookUrl || '-');
    // Inject badge into first row value
    $('watchBody').querySelector('.kv .v').innerHTML = status;
  }catch(e){
    $('watchBody').innerHTML = '<div class="empty">Failed to load watch info</div>';
  }
}

async function loadMappings(){
  if(!currentUserId){
    $('mappingsBody').innerHTML = '<div class="empty">No user ID</div>';
    return;
  }
  try{
    const d = await api('/mappings/'+encodeURIComponent(currentUserId));
    if(!d.mappings.length){
      $('mappingsBody').innerHTML = '<div class="empty">No event mappings yet</div>';
      return;
    }
    let html = '<div style="margin-bottom:8px;color:var(--muted)">Total: <strong style="color:var(--text)">'+d.count+'</strong> mappings (showing latest 100)</div>';
    html += '<table><tr><th>Google Event ID</th><th>LW Event ID</th><th>Last Source</th><th>Updated</th></tr>';
    for(const m of d.mappings){
      html += '<tr>'
        +'<td>'+esc(m.googleEventId)+'</td>'
        +'<td>'+esc(m.lineworksEventId)+'</td>'
        +'<td>'+badge(m.lastSyncSource, m.lastSyncSource==='google'?'ok':'warn')+'</td>'
        +'<td>'+esc(relTime(m.updatedAt))+'</td>'
        +'</tr>';
    }
    html += '</table>';
    $('mappingsBody').innerHTML = html;
  }catch(e){
    $('mappingsBody').innerHTML = '<div class="empty">Failed to load mappings</div>';
  }
}

async function loadErrors(){
  if(!currentUserId){
    $('errorsBody').innerHTML = '<div class="empty">No user ID</div>';
    return;
  }
  try{
    const d = await api('/errors/'+encodeURIComponent(currentUserId));
    if(!d.errors.length){
      $('errorsBody').innerHTML = '<div class="empty">'+badge('No errors','ok')+' Error queue is empty</div>';
      return;
    }
    let html = '<div style="margin-bottom:8px">'+badge(d.count+' errors','err')+'</div>';
    html += '<table><tr><th>Event ID</th><th>Source</th><th>Action</th><th>Error</th><th>Retries</th><th>Created</th></tr>';
    for(const e of d.errors){
      html += '<tr>'
        +'<td>'+esc(e.eventId)+'</td>'
        +'<td>'+esc(e.source)+'</td>'
        +'<td>'+esc(e.action)+'</td>'
        +'<td style="color:var(--red)">'+esc(e.error)+'</td>'
        +'<td>'+e.retryCount+'</td>'
        +'<td>'+esc(relTime(e.createdAt))+'</td>'
        +'</tr>';
    }
    html += '</table>';
    $('errorsBody').innerHTML = html;
  }catch(e){
    $('errorsBody').innerHTML = '<div class="empty">Failed to load errors</div>';
  }
}

async function loadAll(){
  $('lastRefresh').textContent = 'Refreshing...';
  await Promise.all([loadStatus(), loadUsers()]);
  // after status/users resolve we have currentUserId
  await Promise.all([loadWatch(), loadMappings(), loadErrors()]);
  $('lastRefresh').textContent = 'Last refreshed: ' + new Date().toLocaleTimeString();
}

async function triggerPoll(){
  const btn = $('btnPoll');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try{
    const r = await fetch('/poll', {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    toast(d.status === 'ok' ? 'Poll completed' : 'Poll failed: '+(d.error||'unknown'));
    loadAll();
  }catch(e){
    toast('Poll request failed');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Trigger Poll';
  }
}

async function triggerInitialSync(){
  if(!confirm('Run initial sync? This will sync all events from the last 30 days.')) return;
  const btn = $('btnInitSync');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try{
    const r = await fetch('/admin/initial-sync', {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    if(d.status === 'ok'){
      toast('Initial sync done: G->LW='+d.googleToLw+' LW->G='+d.lwToGoogle);
    } else {
      toast('Initial sync failed: '+(d.error||'unknown'));
    }
    loadAll();
  }catch(e){
    toast('Initial sync request failed');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Initial Sync';
  }
}

async function triggerWatchRenew(){
  const btn = $('btnWatchRenew');
  btn.disabled = true;
  btn.textContent = 'Renewing...';
  try{
    const r = await fetch('/admin/watch/renew', {
      method: 'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    toast(d.status === 'ok' ? 'Watch renewed' : 'Renew failed: '+(d.error||'unknown'));
    loadAll();
  }catch(e){
    toast('Watch renew request failed');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Renew Watch';
  }
}

// Auto-load on page open
loadAll();
// Auto-refresh every 60s
setInterval(loadAll, 60000);
</script>
</body>
</html>`;
}
