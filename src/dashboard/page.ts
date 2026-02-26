/** Returns the full HTML for the admin dashboard (single-page app). */
export function dashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>カレンダー同期 ダッシュボード</title>
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
  .progress-bar{background:var(--border);border-radius:6px;height:20px;overflow:hidden;margin:8px 0}
  .progress-bar-fill{height:100%;border-radius:6px;transition:width .3s;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#0f172a;min-width:2em}
  .progress-bar-fill.ok{background:var(--green)}
  .progress-bar-fill.warn{background:var(--yellow)}
  .progress-bar-fill.err{background:var(--red)}
</style>
</head>
<body>

<h1>カレンダー同期 ダッシュボード</h1>
<p class="subtitle">Google カレンダー &harr; LINE WORKS カレンダー</p>

<div class="refresh-row">
  <span class="time-ago" id="lastRefresh"></span>
  <button onclick="loadAll()">更新</button>
</div>

<!-- Status + Watch -->
<div class="grid">
  <div class="card" id="statusCard">
    <h2>サービス状態</h2>
    <div id="statusBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
  </div>
  <div class="card" id="watchCard">
    <h2>Google Watch チャネル</h2>
    <div id="watchBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
  </div>
</div>

<!-- Sync Progress -->
<div class="card" style="margin-bottom:16px" id="syncCard">
  <h2>初回同期の進捗</h2>
  <div id="syncBody"><div class="empty">データなし</div></div>
</div>

<!-- Users -->
<div class="card" style="margin-bottom:16px" id="usersCard">
  <h2>ユーザー設定</h2>
  <div id="usersBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
</div>

<!-- Mappings -->
<div class="card" style="margin-bottom:16px" id="mappingsCard">
  <h2>イベントマッピング</h2>
  <div id="mappingsBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
</div>

<!-- Errors -->
<div class="card" style="margin-bottom:16px" id="errorsCard">
  <h2>エラーキュー</h2>
  <div id="errorsBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
</div>

<!-- Persistent Logs (Firestore) -->
<div class="card" style="margin-bottom:16px" id="persistentLogsCard">
  <h2>同期ログ <span style="font-size:.75rem;color:var(--muted)">(Firestore 永続化)</span></h2>
  <div id="logStats" style="margin-bottom:12px"></div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
    <select id="logFilterStatus" style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:4px 8px;border-radius:4px;font-size:.82rem">
      <option value="">すべての状態</option>
      <option value="success">成功</option>
      <option value="failure">失敗</option>
      <option value="skipped">スキップ</option>
    </select>
    <select id="logFilterSource" style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:4px 8px;border-radius:4px;font-size:.82rem">
      <option value="">すべてのソース</option>
      <option value="google">Google</option>
      <option value="lineworks">LINE WORKS</option>
    </select>
    <button onclick="loadPersistentLogs(true)" style="padding:4px 12px">検索</button>
  </div>
  <div id="persistentLogsBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
  <div id="logsPagination" style="margin-top:8px;text-align:center"></div>
</div>

<!-- In-memory Logs -->
<div class="card" style="margin-bottom:16px" id="logsCard">
  <h2>メモリ内ログ <span style="font-size:.75rem;color:var(--muted)">(直近100件・再起動で消失)</span></h2>
  <div id="logsBody"><div class="empty"><span class="spinner"></span> 読み込み中...</div></div>
</div>

<!-- Actions -->
<div class="card">
  <h2>アクション</h2>
  <div class="actions">
    <button onclick="triggerPoll()" id="btnPoll">ポーリング実行</button>
    <button onclick="triggerInitialSync()" id="btnInitSync">初回同期</button>
    <button onclick="triggerWatchRenew()" id="btnWatchRenew">Watch 更新</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = '/dashboard/api';
const ADMIN_KEY = new URLSearchParams(location.search).get('apiKey') || '';
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
  return (d?d+'日 ':'')+(h?h+'時間 ':'')+(m?m+'分':'1分未満');
}

function relTime(iso){
  if(!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff/60000);
  if(mins < 1) return 'たった今';
  if(mins < 60) return mins+'分前';
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return hrs+'時間前';
  return Math.floor(hrs/24)+'日前';
}

function authHeaders(){
  const h = {'Content-Type':'application/json'};
  if(ADMIN_KEY) h['Authorization'] = 'Bearer ' + ADMIN_KEY;
  return h;
}

async function api(path, timeoutMs){
  const sep = path.includes('?') ? '&' : '?';
  const url = ADMIN_KEY ? API + path + sep + 'apiKey=' + encodeURIComponent(ADMIN_KEY) : API + path;
  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), timeoutMs || 15000);
  try{
    const r = await fetch(url, {signal: ctrl.signal});
    if(!r.ok) throw new Error('API error: ' + r.status);
    return r.json();
  }finally{ clearTimeout(timer); }
}

async function loadStatus(){
  try{
    const d = await api('/status');
    $('statusBody').innerHTML =
      kv('状態', d.status) +
      kv('稼働時間', fmtUptime(d.uptime)) +
      kv('ユーザーID', d.env.syncUserId) +
      kv('Firestore プロジェクト', d.env.firestoreProject) +
      kv('ポート', d.env.port);
    currentUserId = currentUserId || d.env.syncUserId;
  }catch(e){
    $('statusBody').innerHTML = '<div class="empty">状態の読み込みに失敗しました</div>';
  }
}

async function loadUsers(){
  try{
    const users = await api('/users');
    if(!users.length){
      $('usersBody').innerHTML = '<div class="empty">ユーザーが未設定です</div>';
      return;
    }
    let html = '<table><tr><th>ユーザーID</th><th>Google カレンダー</th><th>LW カレンダー</th><th>Google トークン</th><th>LW トークン</th></tr>';
    for(const u of users){
      html += '<tr>'
        +'<td>'+esc(u.userId)+'</td>'
        +'<td>'+esc(u.googleCalendarId)+'</td>'
        +'<td>'+esc(u.lineworksCalendarId)+'</td>'
        +'<td>'+(u.hasGoogleToken ? badge('OK','ok') : badge('未設定','err'))+'</td>'
        +'<td>'+(u.hasLineworksToken ? badge('OK','ok') : badge('未設定','err'))+'</td>'
        +'</tr>';
      if(!currentUserId) currentUserId = u.userId;
    }
    html += '</table>';
    $('usersBody').innerHTML = html;
  }catch(e){
    $('usersBody').innerHTML = '<div class="empty">ユーザー情報の読み込みに失敗しました</div>';
  }
}

async function loadWatch(){
  if(!currentUserId){
    $('watchBody').innerHTML = '<div class="empty">ユーザーIDがありません</div>';
    return;
  }
  try{
    const d = await api('/watch/'+encodeURIComponent(currentUserId));
    if(!d.active && !d.channelId){
      $('watchBody').innerHTML = '<div class="empty">Watch チャネルが未設定です</div>';
      return;
    }
    const status = d.active
      ? (d.hoursLeft > 24 ? badge('有効','ok') : badge('まもなく期限切れ','warn'))
      : badge('期限切れ','err');
    $('watchBody').innerHTML =
      kv('状態', '') + // placeholder replaced below
      kv('チャネルID', d.channelId || '-') +
      kv('有効期限', d.expiration ? new Date(d.expiration).toLocaleString() : '-') +
      kv('残り時間', d.hoursLeft ? d.hoursLeft + '時間' : '-') +
      kv('Webhook URL', d.webhookUrl || '-');
    // Inject badge into first row value
    $('watchBody').querySelector('.kv .v').innerHTML = status;
  }catch(e){
    $('watchBody').innerHTML = '<div class="empty">Watch 情報の読み込みに失敗しました</div>';
  }
}

async function loadMappings(){
  if(!currentUserId){
    $('mappingsBody').innerHTML = '<div class="empty">ユーザーIDがありません</div>';
    return;
  }
  try{
    const d = await api('/mappings/'+encodeURIComponent(currentUserId));
    if(!d.mappings.length){
      $('mappingsBody').innerHTML = '<div class="empty">イベントマッピングはまだありません</div>';
      return;
    }
    let html = '<div style="margin-bottom:8px;color:var(--muted)">合計: <strong style="color:var(--text)">'+d.count+'</strong> 件（最新100件を表示）</div>';
    html += '<table><tr><th>Google イベントID</th><th>LW イベントID</th><th>最終同期元</th><th>更新日時</th></tr>';
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
    $('mappingsBody').innerHTML = '<div class="empty">マッピング情報の読み込みに失敗しました</div>';
  }
}

function fmtDuration(sec){
  if(sec==null) return '-';
  const m=Math.floor(sec/60), s=sec%60;
  if(m<1) return s+'秒';
  return m+'分'+s+'秒';
}

async function loadSyncStatus(){
  if(!currentUserId){
    $('syncBody').innerHTML = '<div class="empty">ユーザーIDがありません</div>';
    return;
  }
  try{
    const d = await api('/sync-status/'+encodeURIComponent(currentUserId));
    if(!d.active && !d.status){
      $('syncBody').innerHTML = '<div class="empty">初回同期の記録がありません</div>';
      return;
    }
    const isRunning = d.status === 'running';
    const isFailed = d.status === 'failed';
    const phaseLabel = 'Phase ' + d.phase + (d.phase===1?' (Google → LW)':' (LW → Google)');
    const done = d.phase===1 ? d.googleToLw : d.lwToGoogle;
    const pct = d.phaseTotal > 0 ? Math.round((done/d.phaseTotal)*100) : 0;
    const barClass = isFailed ? 'err' : (pct < 50 ? 'warn' : 'ok');
    const statusBadge = isRunning ? badge('実行中','ok')
                      : isFailed ? badge('失敗','err')
                      : badge('完了','ok');

    let html = kv('状態','') + kv('フェーズ', phaseLabel);
    // inject badge
    html = html.replace(/<span class="v"><\/span>/, '<span class="v">'+statusBadge+'</span>');

    if(isRunning || isFailed){
      html += '<div class="progress-bar"><div class="progress-bar-fill '+barClass+'" style="width:'+Math.max(pct,2)+'%">'+pct+'%</div></div>';
      html += kv('成功', done + ' / ' + d.phaseTotal);
      html += kv('失敗', String(d.phaseFailed));
      html += kv('経過時間', fmtDuration(d.elapsedSec));
    } else {
      html += kv('Google → LW', d.googleToLw + ' 件');
      html += kv('LW → Google', d.lwToGoogle + ' 件');
    }
    html += kv('最終更新', relTime(d.updatedAt));
    if(d.error) html += kv('エラー', d.error);

    $('syncBody').innerHTML = html;
  }catch(e){
    $('syncBody').innerHTML = '<div class="empty">同期状態の読み込みに失敗しました</div>';
  }
}

async function loadErrors(){
  if(!currentUserId){
    $('errorsBody').innerHTML = '<div class="empty">ユーザーIDがありません</div>';
    return;
  }
  try{
    const d = await api('/errors/'+encodeURIComponent(currentUserId));
    if(!d.errors.length){
      $('errorsBody').innerHTML = '<div class="empty">'+badge('エラーなし','ok')+' エラーキューは空です</div>';
      return;
    }
    let html = '<div style="margin-bottom:8px">'+badge(d.count+' 件のエラー','err')+'</div>';
    html += '<table><tr><th>イベントID</th><th>ソース</th><th>アクション</th><th>エラー内容</th><th>リトライ回数</th><th>発生日時</th></tr>';
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
    $('errorsBody').innerHTML = '<div class="empty">エラー情報の読み込みに失敗しました</div>';
  }
}

async function loadLogs(){
  try{
    const d = await api('/logs?limit=100');
    if(!d.logs || !d.logs.length){
      $('logsBody').innerHTML = '<div class="empty">ログはまだありません</div>';
      return;
    }
    let html = '<table><tr><th>時刻</th><th>アクション</th><th>状態</th><th>ソース</th><th>イベントID</th><th>詳細 / エラー</th></tr>';
    for(const l of d.logs){
      const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-';
      const statusBadge = l.status === 'success' ? badge('OK','ok')
                        : l.status === 'failure' ? badge('ERR','err')
                        : badge('SKIP','off');
      const detail = l.error ? '<span style="color:var(--red)">'+esc(l.error)+'</span>'
                   : l.details ? esc(JSON.stringify(l.details).slice(0,120))
                   : '-';
      html += '<tr>'
        +'<td style="white-space:nowrap">'+esc(time)+'</td>'
        +'<td>'+esc(l.action||'-')+'</td>'
        +'<td>'+statusBadge+'</td>'
        +'<td>'+esc(l.source||'-')+'</td>'
        +'<td>'+esc(l.eventId||'-')+'</td>'
        +'<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">'+detail+'</td>'
        +'</tr>';
    }
    html += '</table>';
    $('logsBody').innerHTML = html;
  }catch(e){
    $('logsBody').innerHTML = '<div class="empty">ログの読み込みに失敗しました</div>';
  }
}

let logNextCursor = null;

async function loadLogStats(){
  try{
    const d = await api('/log-stats');
    const total = d.total || 0;
    $('logStats').innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap">'
      +'<span>合計: <strong>'+total+'</strong></span>'
      +'<span>'+badge(d.success+' 成功','ok')+'</span>'
      +'<span>'+badge(d.failure+' 失敗','err')+'</span>'
      +'<span>'+badge(d.skipped+' スキップ','off')+'</span>'
      +'</div>';
  }catch(e){
    $('logStats').innerHTML = '';
  }
}

async function loadPersistentLogs(reset){
  if(reset) logNextCursor = null;
  const status = $('logFilterStatus').value;
  const source = $('logFilterSource').value;
  let url = '/persistent-logs?limit=50';
  if(status) url += '&status='+encodeURIComponent(status);
  if(source) url += '&source='+encodeURIComponent(source);
  if(logNextCursor) url += '&before='+encodeURIComponent(logNextCursor);

  try{
    const d = await api(url);
    if(!d.logs || !d.logs.length){
      if(reset || !logNextCursor){
        $('persistentLogsBody').innerHTML = '<div class="empty">ログはまだありません</div>';
      }
      $('logsPagination').innerHTML = '';
      return;
    }
    let html = '<table><tr><th>日時</th><th>アクション</th><th>状態</th><th>ソース</th><th>イベントID</th><th>詳細 / エラー</th></tr>';
    for(const l of d.logs){
      const time = l.timestamp ? new Date(l.timestamp).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '-';
      const statusBadge = l.status === 'success' ? badge('OK','ok')
                        : l.status === 'failure' ? badge('ERR','err')
                        : badge('SKIP','off');
      const detail = l.error ? '<span style="color:var(--red)">'+esc(l.error)+'</span>'
                   : l.details ? esc(JSON.stringify(l.details).slice(0,120))
                   : '-';
      html += '<tr>'
        +'<td style="white-space:nowrap">'+esc(time)+'</td>'
        +'<td>'+esc(l.action||'-')+'</td>'
        +'<td>'+statusBadge+'</td>'
        +'<td>'+esc(l.source||'-')+'</td>'
        +'<td>'+esc(l.eventId||'-')+'</td>'
        +'<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">'+detail+'</td>'
        +'</tr>';
    }
    html += '</table>';

    if(reset || !logNextCursor){
      $('persistentLogsBody').innerHTML = html;
    } else {
      // Append rows to existing table
      const existing = $('persistentLogsBody').querySelector('table');
      if(existing){
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const rows = temp.querySelectorAll('tr');
        for(let i=1; i<rows.length; i++) existing.appendChild(rows[i]);
      } else {
        $('persistentLogsBody').innerHTML = html;
      }
    }

    logNextCursor = d.nextCursor;
    if(d.nextCursor){
      $('logsPagination').innerHTML = '<button onclick="loadPersistentLogs(false)" style="padding:4px 16px">さらに読み込む</button>';
    } else {
      $('logsPagination').innerHTML = '<span style="color:var(--muted);font-size:.8rem">すべてのログを表示しました</span>';
    }
  }catch(e){
    $('persistentLogsBody').innerHTML = '<div class="empty">永続ログの読み込みに失敗しました</div>';
    $('logsPagination').innerHTML = '';
  }
}

async function loadAll(){
  $('lastRefresh').textContent = '更新中...';
  try{ await Promise.all([loadStatus(), loadUsers()]); }catch(e){}
  // after status/users resolve we have currentUserId – fire remaining in parallel, don't block each other
  const tasks = [loadWatch(), loadSyncStatus(), loadMappings(), loadErrors(), loadLogs(), loadLogStats(), loadPersistentLogs(true)];
  await Promise.allSettled(tasks);
  $('lastRefresh').textContent = '最終更新: ' + new Date().toLocaleTimeString();
}

async function triggerPoll(){
  const btn = $('btnPoll');
  btn.disabled = true;
  btn.textContent = '実行中...';
  try{
    const r = await fetch('/poll', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    toast(d.status === 'ok' ? 'ポーリング完了' : 'ポーリング失敗: '+(d.error||'不明'));
    loadAll();
  }catch(e){
    toast('ポーリングリクエストに失敗しました');
  }finally{
    btn.disabled = false;
    btn.textContent = 'ポーリング実行';
  }
}

async function triggerInitialSync(){
  if(!confirm('初回同期を実行しますか？過去30日分のイベントが同期されます。')) return;
  const btn = $('btnInitSync');
  btn.disabled = true;
  btn.textContent = '実行中...';
  try{
    const r = await fetch('/admin/initial-sync', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    if(d.status === 'accepted' || d.status === 'ok'){
      toast('初回同期を開始しました。進捗はダッシュボードで確認できます。');
      // Poll for sync progress while running
      const pollProgress = setInterval(async ()=>{
        try{
          const s = await api('/sync-status/'+encodeURIComponent(currentUserId));
          if(s.status !== 'running'){
            clearInterval(pollProgress);
            loadAll();
            toast(s.status === 'completed' ? '初回同期が完了しました' : '初回同期が失敗しました: '+(s.error||'不明'));
          } else {
            loadSyncStatus();
          }
        }catch(e){ clearInterval(pollProgress); }
      }, 5000);
    } else {
      toast('初回同期失敗: '+(d.error||'不明'));
    }
    loadAll();
  }catch(e){
    toast('初回同期リクエストに失敗しました');
  }finally{
    btn.disabled = false;
    btn.textContent = '初回同期';
  }
}

async function triggerWatchRenew(){
  const btn = $('btnWatchRenew');
  btn.disabled = true;
  btn.textContent = '更新中...';
  try{
    const r = await fetch('/admin/watch/renew', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: currentUserId }),
    });
    const d = await r.json();
    toast(d.status === 'ok' ? 'Watch 更新完了' : 'Watch 更新失敗: '+(d.error||'不明'));
    loadAll();
  }catch(e){
    toast('Watch 更新リクエストに失敗しました');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Watch 更新';
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
