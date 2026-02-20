/**
 * Google OAuth2 リフレッシュトークン取得スクリプト
 *
 * 使い方:
 *   1. .env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定
 *   2. npx ts-node scripts/get-google-token.ts
 *   3. 表示されるURLをブラウザで開く
 *   4. Googleアカウントでログインして許可する
 *   5. 自動的にリダイレクトされ、トークンが表示される
 *
 * 事前準備:
 *   Google Cloud Console → 認証情報 → 承認済みリダイレクトURIに
 *   http://localhost:3000/callback を追加しておくこと
 */
import { google } from "googleapis";
import http from "http";
import { config } from "dotenv";

config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("エラー: .env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/calendar"],
});

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
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n========================================");
    console.log("トークン取得成功!");
    console.log("========================================\n");
    console.log("Refresh Token:", tokens.refresh_token);
    console.log("\nこのリフレッシュトークンを .env の");
    console.log("GOOGLE_REFRESH_TOKEN に設定してください。");
    console.log("========================================\n");

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <h1>トークン取得成功!</h1>
      <p>Refresh Token:</p>
      <pre style="background:#f0f0f0;padding:10px;word-break:break-all">${tokens.refresh_token}</pre>
      <p>このリフレッシュトークンを .env の GOOGLE_REFRESH_TOKEN に設定してください。</p>
      <p>ターミナルに戻って Ctrl+C で終了してください。</p>
    `);
  } catch (err) {
    console.error("\nエラー:", err);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>エラー</h1><pre>${err}</pre>`);
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
