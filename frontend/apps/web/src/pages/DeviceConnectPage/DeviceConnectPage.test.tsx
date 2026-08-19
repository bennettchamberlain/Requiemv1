import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceConnectPage } from './DeviceConnectPage';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

const h = vi.hoisted(() => ({
  persistApiBaseUrl: vi.fn(),
  signInToPortal: vi.fn(),
  listMemoryServers: vi.fn(),
  loginWithPortalOidc: vi.fn(),
  resumePendingOidcLogin: vi.fn(async () => null),
}));

vi.mock('@ci/common', () => ({
  persistApiBaseUrl: h.persistApiBaseUrl,
}));

vi.mock('./portal-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./portal-client')>();

  return {
    ...actual,
    signInToPortal: h.signInToPortal,
    listMemoryServers: h.listMemoryServers,
  };
});

vi.mock('./oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oidc')>();

  return {
    ...actual,
    loginWithPortalOidc: h.loginWithPortalOidc,
    resumePendingOidcLogin: h.resumePendingOidcLogin,
  };
});

beforeEach(() => {
  navigate.mockReset();
  h.persistApiBaseUrl.mockReset();
  h.signInToPortal.mockReset();
  h.listMemoryServers.mockReset();
  h.loginWithPortalOidc.mockReset();
  h.resumePendingOidcLogin.mockReset();
  h.resumePendingOidcLogin.mockResolvedValue(null);
});

describe('DeviceConnectPage', () => {
  it('does not use the /connect Sources route and matches the Hub first screen', () => {
    render(<DeviceConnectPage />);

    expect(screen.getByText('Connect to your Memory')).toBeInTheDocument();
    expect(screen.getByTestId('oidc-login-btn')).toBeInTheDocument();
    expect(screen.getByText(/or use email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter a memory server url instead/i })).toBeInTheDocument();
  });

  it('lists Memory Servers after Portal email sign-in and persists a healthy origin', async () => {
    h.signInToPortal.mockResolvedValue({ token: 't', cookie: null, kind: 'session' });
    h.listMemoryServers.mockResolvedValue([
      { id: 'home', name: 'Home', status: 'active', memoryUrl: 'https://memory.example.com/app' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    render(<DeviceConnectPage />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in with email/i }).closest('form')!);

    expect(await screen.findByText('Home')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('memory-row-home'));

    await waitFor(() => {
      expect(h.persistApiBaseUrl).toHaveBeenCalledWith('https://memory.example.com');
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('lists Memory Servers after Portal OIDC', async () => {
    h.loginWithPortalOidc.mockResolvedValue({ accessToken: 'oidc-at', idToken: null, tokenType: 'Bearer', expiresIn: 3600 });
    h.listMemoryServers.mockResolvedValue([
      { id: 'home', name: 'Home', status: 'active', memoryUrl: 'https://memory.example.com/app' },
    ]);

    render(<DeviceConnectPage />);
    fireEvent.click(screen.getByTestId('oidc-login-btn'));

    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(h.listMemoryServers).toHaveBeenCalledWith(
      { token: 'oidc-at', cookie: null, kind: 'oauth' },
      expect.any(String),
    );
  });
});
