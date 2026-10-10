import { Hono } from 'hono';
import type { DesktopConfig } from '../config.js';
import {
  clearSessionCookieHeader,
  parseSessionCookie,
  sessionCookieHeader,
  sessionFromToken,
  signIn,
  signOut,
  signUp,
} from '../auth/session.js';
import { isAdmin } from '../auth/rbac.js';

export function authRoutes(cfg: DesktopConfig) {
  const app = new Hono();

  app.post('/sign-up', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const { user } = signUp({
        email: String(body.email || ''),
        password: String(body.password || ''),
        name: String(body.name || ''),
      });
      // Auto sign-in
      const session = signIn({
        email: user.email,
        password: String(body.password || ''),
        ip: c.req.header('x-forwarded-for') || undefined,
      });
      c.header('Set-Cookie', sessionCookieHeader(session.token, session.expiresAt));
      return c.json({
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
          isAdmin: isAdmin(session.user, cfg),
        },
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message || 'Sign-up failed' }, (err.status as 400) || 400);
    }
  });

  app.post('/sign-in', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = signIn({
        email: String(body.email || ''),
        password: String(body.password || ''),
        ip: c.req.header('x-forwarded-for') || undefined,
      });
      c.header('Set-Cookie', sessionCookieHeader(session.token, session.expiresAt));
      return c.json({
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
          isAdmin: isAdmin(session.user, cfg),
        },
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message || 'Sign-in failed' }, (err.status as 401) || 401);
    }
  });

  app.post('/sign-out', async (c) => {
    const token = parseSessionCookie(c.req.header('cookie'));
    signOut(token || undefined);
    c.header('Set-Cookie', clearSessionCookieHeader());
    return c.json({ ok: true });
  });

  app.get('/session', (c) => {
    const token = parseSessionCookie(c.req.header('cookie'));
    const session = sessionFromToken(token);
    if (!session) return c.json({ user: null });
    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
        isAdmin: isAdmin(session.user, cfg),
      },
    });
  });

  return app;
}
