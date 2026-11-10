// LabFlow — Cloud Run エントリポイント
//   /            静的ファイル（public/）
//   /api/*       JSON API（Firebase ID トークン必須。/api/config のみ公開）
//   /healthz     ヘルスチェック
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { api } from './src/routes.js';
import { HttpError, log } from './src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// セキュリティヘッダー。Google ログインのポップアップを使うため COOP は same-origin-allow-popups
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'geolocation=(), microphone=()',
  });
  if (config.onCloudRun) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// 画像・PDF を base64 で受け取るため上限を広げる（Cloud Run のリクエスト上限は 32MiB）
app.use('/api', express.json({ limit: `${Math.ceil(config.maxUploadMB * 1.4) + 1}mb` }));
app.use('/api', api);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API が見つかりません')));

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders(res, file) {
      res.set('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
    },
  }),
);
// 旧ファイル名でのアクセスにも応える
app.get(['/labflow.html', '/labflow'], (_req, res) => res.redirect(301, '/'));

// エラーは JSON で返す（スタックトレースは返さない）
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.too.large' ? 413 : err.status === 400 ? 400 : 500;
  const message =
    err instanceof HttpError ? err.message
    : status === 413 ? 'ファイルが大きすぎます'
    : status === 400 ? 'リクエストの形式が正しくありません'
    : 'サーバーでエラーが発生しました';
  if (status >= 500) log.error('unhandled', { path: req.path, err: String(err?.stack || err).slice(0, 2000) });
  res.status(status).json({ error: { message, code: err.code || '' } });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = app.listen(config.port, () => {
    log.info(`LabFlow listening on :${config.port}`, { authMode: config.authMode, store: config.store, aiMode: config.aiMode, project: config.projectId });
  });
  // Cloud Run はスケールイン時に SIGTERM を送る
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
