# AquaWorldBot Worker (Cloudflare) - Final Version

- ریپلای برای /بن, /اخطار, /سکوت, /باز
- سیستم اخطار (warn) در KV
- لیست فحش فارسی
- دستورات کوتاه فارسی /تنظیم <کلید> on|off
- هوش مصنوعی (عادی + تخصصی آکواریوم)
- آیدی ربات: @AquaWorldir_bot

## Deploy

1. نصب wrangler:
npm i -g @cloudflare/wrangler

2. ورود:
wrangler login

3. انتشار:
wrangler publish

4. ست کردن وبهوک تلگرام:
https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://<your-subdomain>.workers.dev/<WEBHOOK_SECRET>