# CloudFlare Tunnel セットアップ

## 1. インストール
```bash
brew install cloudflared
```

## 2. ログイン (scrambler-lab.com のアカウントで)
```bash
cloudflared tunnel login
```

## 3. トンネル作成
```bash
cloudflared tunnel create logger
# → トンネルID が表示される (例: abc123...)
```

## 4. config.yml の編集
`cloudflare/config.yml` の `TUNNEL_ID` を実際のIDに置き換え:
```yaml
tunnel: abc123...
credentials-file: /Users/nobu/.cloudflared/abc123....json
ingress:
  - hostname: log.scrambler-lab.com
    service: http://localhost:8000
  - service: http_status:404
```

## 5. DNS ルーティング設定
```bash
cloudflared tunnel route dns logger log.scrambler-lab.com
```

## 6. テスト起動
```bash
cloudflared tunnel --config cloudflare/config.yml run
```

## 7. Mac launchd 自動起動 (Mac再起動後も自動起動)
```bash
sudo cloudflared service install
```
サービス設定は `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist` に保存されます。

## バックエンド起動スクリプト
```bash
#!/bin/bash
# start.sh
cd /Users/nobu/dev/ai/logger/backend
source .venv/bin/activate 2>/dev/null || true
ANTHROPIC_API_KEY="sk-ant-..." uvicorn main:app --host 0.0.0.0 --port 8000
```

## フロントエンドのビルド (本番用)
```bash
cd /Users/nobu/dev/ai/logger/frontend
npm run build
# → dist/ フォルダに出力 → バックエンドからStaticFilesとして配信するか別ポートで起動
```
