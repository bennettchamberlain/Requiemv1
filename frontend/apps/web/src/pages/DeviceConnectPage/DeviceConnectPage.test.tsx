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

beforeEach(() => {
  navigate.mockReset();
  h.persistApiBaseUrl.mockReset();
  h.signInToPortal.mockReset();
  h.listMemoryServers.mockReset();
});

describe('DeviceConnectPage', () => {
  it('does not use the /connect Sources route', () => {
    render(<DeviceConnectPage />);

    expect(screen.getByText(/connect this device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter a memory server url instead/i })).toBeInTheDocument();
  });

  it('lists Memory Servers after Portal sign-in and persists a healthy origin', async () => {
    h.signInToPortal.mockResolvedValue({ token: 't', cookie: null, kind: 'session' });
    h.listMemoryServers.mockResolvedValue([
      { id: 'home', name: 'Home', status: 'active', memoryUrl: 'https://memory.example.com/app' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    render(<DeviceConnectPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in and find servers/i }).closest('form')!);

    expect(await screen.findByText('Home')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('memory-row-home'));

    await waitFor(() => {
      expect(h.persistApiBaseUrl).toHaveBeenCalledWith('https://memory.example.com');
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });
});
