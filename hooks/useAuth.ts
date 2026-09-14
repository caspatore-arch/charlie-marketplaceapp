/**
 * Auth context hook. The actual state lives in <AuthProvider> (components/AuthProvider.tsx);
 * this file only defines the context shape + the two hooks screens use.
 */
import { createContext, useContext } from 'react';
import { useRouter } from 'expo-router';
import type { AuthUser } from '@/types';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Step 1 of email sign-in: server prints a 6-digit code to its log (simulated email). */
  requestCode: (email: string) => Promise<void>;
  /** Step 2: verify the code (and optionally set a display name on first sign-in). */
  signInWithCode: (email: string, code: string, displayName?: string) => Promise<void>;
  /** Dev-only shortcut, enabled when EXPO_PUBLIC_DEV_LOGIN === '1'. */
  devSignIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Read auth state + actions. Must be used within <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/**
 * Returns a guard function screens call before a gated action (message seller,
 * request meetup, save, sell, etc). If signed out, it routes to sign-in with
 * `returnTo` set to the current path and returns false; otherwise returns true.
 *
 * Usage: `const requireAuth = useRequireAuth(); if (!requireAuth('/listing/123')) return;`
 */
export function useRequireAuth() {
  const { status } = useAuth();
  const router = useRouter();

  return function requireAuth(returnTo: string): boolean {
    if (status === 'signedIn') return true;
    router.push({ pathname: '/auth/sign-in', params: { returnTo } });
    return false;
  };
}
