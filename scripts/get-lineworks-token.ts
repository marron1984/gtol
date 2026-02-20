/**
 * LINE WORKS OAuth2 リフレッシュトークン取得スクリプト
 *
 * 使い方:
 *   1. .env に LW_CLIENT_ID と LW_CLIENT_SECRET を設定
 *   2. npx ts-node scripts/get-lineworks-token.ts
 *   3. 表示されるURLをブラウザで開く
 *   4. LINE WORKSアカウントでログインして許可する
 *   5. 自動的にリダイレクトされ、トークンが表示される
 *
 * 事前準備:
 *   LINE WORKS Developer Console → OAuth App → Redirect URLに
 *   http://localhost:3000/callback を追加しておくこと
 */
import axios from "axios";
import http from "http";
import { config } from "dotenv";

config();

const CLIENT_ID = process.env.LW_CLIENT_ID;
const CLIENT_SECRET = process.env.LW_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("エラー: .env に LW_CLIENT_ID と LW_CLIENT_SECRET を設定してください。");
  process.exit(1);
}

const AUTHORIZE_URL = "https://auth.worksmobile.com/oauth2/v2.0/authorize";
const TOKEN_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";

const authUrl = `${AUTHORIZE_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=calendar%20bot&state=random123`;

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) return;

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>エラー: 認証コードがありません</h1>");
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await axios.post(TOKEN_URL, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const { refresh_token } = tokenRes.data;

    console.log("\n========================================");
    console.log("トークン取得成功!");
    console.log("========================================\n");
    console.log("Refresh Token:", refresh_token);
    console.log("\nこのリフレッシュトークンを .env の");
    console.log("LW_REFRESH_TOKEN に設定してください。");
    console.log("========================================\n");

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <h1>トークン取得成功!</h1>
      <p>Refresh Token:</p>
      <pre style="background:#f0f0f0;padding:10px;word-break:break-all">${refresh_token}</pre>
      <p>このリフレッシュトークンを .env の LW_REFRESH_TOKEN に設定してください。</p>
      <p>ターミナルに戻って Ctrl+C で終了してください。</p>
    `);
  } catch (err: any) {
    console.error("\nエラー:", err.response?.data || err.message);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>エラー</h1><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

server.listen(3000, () => {
  console.log("\n========================================");
  console.log("以下のURLをブラウザで開いてください:");
  console.log("========================================\n");
  console.log(authUrl);
  console.log("\nログイン後、自動的にトークンが表示されます。");
  console.log("待機中...\n");
});
