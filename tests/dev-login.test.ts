import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import { getConfig } from '../server/config';
import { handleApi } from '../server/handler';

const saved = { ...process.env };
beforeEach(() => {
  resetMemoryDb();
});
afterEach(() => {
  process.env = { ...saved };
});

describe('local staff test sign-in (DEV_STAFF_LOGIN)', () => {
  it('is off by default in firebase mode', () => {
    process.env.BACKEND_MODE = 'firebase';
    delete process.env.DEV_STAFF_LOGIN;
    expect(getConfig().devStaffLogin).toBe(false);
    expect(getConfig().devStaffEmails).toEqual([]);
  });

  it('can be switched on locally in firebase mode', () => {
    process.env.BACKEND_MODE = 'firebase';
    process.env.DEV_STAFF_LOGIN = 'true';
    expect(getConfig().devStaffLogin).toBe(true);
  });

  it('refuses to start on a deployed Netlify Function (AWS Lambda)', () => {
    process.env.BACKEND_MODE = 'firebase';
    process.env.DEV_STAFF_LOGIN = 'true';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
    process.env.RM_LOCAL_DEV = '1'; // even if someone also sets this
    expect(() => getConfig()).toThrow(/only allowed on your own computer/);
  });

  it('memory mode is also refused on a deployed function', () => {
    process.env.BACKEND_MODE = 'memory';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
    expect(() => getConfig()).toThrow(/only allowed for local development/);
  });

  it('only accepts requests addressed to localhost', async () => {
    const call = (host: string) =>
      handleApi(new Request(`http://${host}/api/me`, { headers: { authorization: 'Bearer dev:staff@test.local' } }));
    expect((await call('localhost')).status).toBe(200);
    expect((await call('127.0.0.1:5173')).status).toBe(200);
    expect((await call('my-site.netlify.app')).status).toBe(401);
    expect((await call('192.168.1.20:5173')).status).toBe(401);
  });

  describe('with the dev server’s real socket address', () => {
    const call = (socketAddress: string, host = 'localhost:5173', headers: Record<string, string> = {}) =>
      handleApi(
        new Request(`http://${host}/api/me`, { headers: { authorization: 'Bearer dev:admin@test.local', ...headers } }),
        { ip: socketAddress, socketAddress },
      );

    it('accepts this computer even when opened via its LAN address', async () => {
      expect((await call('127.0.0.1')).status).toBe(200);
      expect((await call('::1')).status).toBe(200);
      expect((await call('::ffff:127.0.0.1', '192.168.0.16:5173')).status).toBe(200);
    });

    it('cannot be fooled by another device sending "Host: localhost"', async () => {
      const r = await call('192.168.0.27', 'localhost:5173');
      expect(r.status).toBe(401);
    });

    it('treats an unknown socket address as not local', async () => {
      expect((await call('')).status).toBe(401);
    });

    describe('npm run dev:lan', () => {
      beforeEach(() => {
        process.env.RM_DEV_LAN = '1';
        process.env.DEV_LAN_PASSCODE = 'ABCD2345';
      });

      it('needs the passcode from a phone on the Wi-Fi', async () => {
        const none = await call('192.168.0.27', '192.168.0.16:5173');
        expect(none.status).toBe(401);
        expect((await none.json()).error.code).toBe('DEV_PASSCODE_REQUIRED');
        expect((await call('192.168.0.27', '192.168.0.16:5173', { 'x-dev-passcode': 'WRONG123' })).status).toBe(401);
      });

      it('accepts a phone on the Wi-Fi with the right passcode (dash and case ignored)', async () => {
        const r = await call('::ffff:192.168.0.27', '192.168.0.16:5173', { 'x-dev-passcode': 'abcd-2345' });
        expect(r.status).toBe(200);
        expect((await r.json()).me.role).toBe('admin');
      });

      it('still refuses public internet addresses, even with the passcode', async () => {
        expect((await call('8.8.8.8', '192.168.0.16:5173', { 'x-dev-passcode': 'ABCD2345' })).status).toBe(401);
      });

      it('still only accepts listed test emails', async () => {
        const r = await handleApi(
          new Request('http://192.168.0.16:5173/api/me', {
            headers: { authorization: 'Bearer dev:not-listed@test.local', 'x-dev-passcode': 'ABCD2345' },
          }),
          { socketAddress: '192.168.0.27' },
        );
        expect(r.status).toBe(403);
      });

      it('rejects a short custom passcode at start-up', () => {
        process.env.DEV_LAN_PASSCODE = 'abc';
        expect(() => getConfig()).toThrow(/at least 8/);
      });

      it('is never active on a deployed function', () => {
        process.env.BACKEND_MODE = 'firebase';
        process.env.DEV_STAFF_LOGIN = 'false';
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
        expect(getConfig().devLanLogin).toBe(false);
      });
    });
  });

  it('only accepts emails listed in DEV_STAFF_EMAILS or DEV_ADMIN_EMAILS', async () => {
    const r = await handleApi(
      new Request('http://localhost/api/me', { headers: { authorization: 'Bearer dev:not-listed@test.local' } }),
    );
    expect(r.status).toBe(403);
  });
});
