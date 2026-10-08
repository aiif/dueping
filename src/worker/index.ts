import { Hono } from 'hono';
import { authApp, authMiddleware, csrfMiddleware } from './auth';
import { contractsApp } from './contracts';
import { settingsApp } from './settings';
import { handleScheduled } from './scheduled';

const app = new Hono<{ Bindings: Env }>();

// Apply CSRF protection for all mutations
app.use('/api/*', csrfMiddleware);

// Mount auth routes (unprotected for OTP request & verify, protected for me)
app.route('/api/auth', authApp);

// Mount contracts routes (protected)
app.use('/api/contracts/*', authMiddleware);
app.use('/api/contracts', authMiddleware);
app.route('/api/contracts', contractsApp);

// Mount settings routes (protected)
app.use('/api/settings/*', authMiddleware);
app.use('/api/settings', authMiddleware);
app.route('/api/settings', settingsApp);

// Health check / test scheduled endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', service: 'dueping' });
});

// Test trigger for scheduled handler (convenient in development/testing environments)
app.all('/api/test/trigger-scheduled', async (c) => {
  const result = await handleScheduled(c.env);
  return c.json({ success: true, result });
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
