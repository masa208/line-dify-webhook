const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
 
const app = express();
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
 
// =============================
// 環境変数（Glitchで設定します）
// =============================
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
 
// ユーザーごとのDify会話IDを記憶（サーバー再起動でリセットされます）
const conversationMap = {};
 
// =============================
// LINE署名検証
// =============================
function verifyLineSignature(req) {
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    console.log('No signature header found');
    return false;
  }
  if (!LINE_CHANNEL_SECRET) {
    console.log('LINE_CHANNEL_SECRET not set');
    return false;
  }
  const body = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  console.log('Expected:', hash);
  console.log('Received:', signature);
  return hash === signature;
}
 
// =============================
// Dify APIを呼び出す
// =============================
async function callDify(userId, userMessage) {
  const conversationId = conversationMap[userId] || '';
 
  const response = await axios.post(
    DIFY_API_URL,
    {
      inputs: {},
      query: userMessage,
      response_mode: 'blocking',
      conversation_id: conversationId,
      user: userId,
    },
    {
      headers: {
        Authorization: `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
 
  // 会話IDを保存（続きの会話に使う）
  if (response.data.conversation_id) {
    conversationMap[userId] = response.data.conversation_id;
  }
 
  return response.data.answer;
}
 
// =============================
// LINEに返信を送る
// =============================
async function replyToLine(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }],
    },
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}
 
// =============================
// Webhookエンドポイント
// =============================
app.post('/webhook', async (req, res) => {
  // LINE署名を検証
  if (!verifyLineSignature(req)) {
    console.error('Invalid signature');
    return res.status(403).send('Forbidden');
  }
 
  res.status(200).send('OK'); // LINEへ先に200を返す（タイムアウト防止）
 
  const events = req.body.events || [];
 
  for (const event of events) {
    try {
      const userId = event.source?.userId;
      const replyToken = event.replyToken;
 
      // 友達追加イベント
      if (event.type === 'follow') {
        const welcomeMsg = await callDify(userId, 'はじめまして！友だち追加しました！');
        await replyToLine(replyToken, welcomeMsg);
        continue;
      }
 
      // テキストメッセージイベント
      if (event.type === 'message' && event.message?.type === 'text') {
        const userMessage = event.message.text;
        const difyResponse = await callDify(userId, userMessage);
        await replyToLine(replyToken, difyResponse);
      }
    } catch (err) {
      console.error('Error handling event:', err.response?.data || err.message);
    }
  }
});
 
// =============================
// ヘルスチェック
// =============================
app.get('/', (req, res) => {
  res.send('LINE-Dify Webhook Server is running!');
});
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
 
