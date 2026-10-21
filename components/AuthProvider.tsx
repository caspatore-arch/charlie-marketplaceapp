/**
 * Owns auth state: loads the persisted token, fetches `auth.me`, and exposes
 * sign-in/out actions via useAuth(). Must render inside <trpc.Provider> +
 * <QueryClientProvider> (see app/_layout.tsx) since it uses trpc hooks.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { trpc, authStorage } from '@/lib/trpc';
import { AuthContext, type AuthStatus } from '@/hooks/useAuth';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hasToken, setHasToken] = useState<boolean | null>(null); // null = still checking storage
  const utils = trpc.useUtils();

  useEffect(() => {
    authStorage.getToken().then((token) => setHasToken(!!token));
  }, []);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: hasToken === true,
    retry: false,
  });

  const requestCodeMutation = trpc.auth.requestCode.useMutation();
  const verifyCodeMutation = trpc.auth.verifyCode.useMutation();
  const requestPhoneCodeMutation = trpc.auth.requestPhoneCode.useMutation();
  const verifyPhoneCodeMutation = trpc.auth.verifyPhoneCode.useMutation();
  const devSignInMutation = trpc.auth.devSignIn.useMutation();
  const signOutMutation = trpc.auth.signOut.useMutation();

  const requestCode = useCallback(
    (email: string) => requestCodeMutation.mutateAsync({ email }),
    [requestCodeMutation],
  );

  // `verifyCode`/`devSignIn` return a user shape without the joined `campus`
  // (see backend/trpc/routes/auth.ts), unlike `auth.me` which always includes
  // it — so rather than seed the me-query cache with a mismatched shape, we
  // persist the token and let the now-enabled `auth.me` query fetch the full
  // record from the server.
  const applySession = useCallback(
    async (token: string) => {
      await authStorage.setToken(token);
      setHasToken(true);
      // A different user is now signed in: every cached query (my listings,
      // inbox, moderator flag, ...) belongs to the previous identity.
      await utils.invalidate();
    },
    [utils],
  );

  const signInWithCode = useCallback(
    async (email: string, code: string, displayName?: string) => {
      const result = await verifyCodeMutation.mutateAsync({ email, code, displayName });
      await applySession(result.token);
    },
    [verifyCodeMutation, applySession],
  );

  const requestPhoneCode = useCallback(
    (phone: string) => requestPhoneCodeMutation.mutateAsync({ phone }),
    [requestPhoneCodeMutation],
  );

  const verifyPhoneCode = useCallback(
    async (input: Parameters<typeof verifyPhoneCodeMutation.mutateAsync>[0]) => {
      const result = await verifyPhoneCodeMutation.mutateAsync(input);
      if (result.status === 'signed_in') await applySession(result.token);
      return result;
    },
    [verifyPhoneCodeMutation, applySession],
  );

  const devSignIn = useCallback(
    async (userId: string) => {
      const result = await devSignInMutation.mutateAsync({ userId });
      await applySession(result.token);
    },
    [devSignInMutation, applySession],
  );

  const signOut = useCallback(async () => {
    try {
      if (hasToken) await signOutMutation.mutateAsync();
    } catch {
      // best-effort: still clear local state even if the server call fails
    }
    await authStorage.clearToken();
    setHasToken(false);
    utils.auth.me.setData(undefined, undefined);
    await utils.invalidate();
  }, [hasToken, signOutMutation, utils]);

  const status: AuthStatus = useMemo(() => {
    if (hasToken === null) return 'loading';
    if (!hasToken) return 'signedOut';
    if (meQuery.isPending) return 'loading';
    if (meQuery.isError) return 'signedOut';
    return meQuery.data ? 'signedIn' : 'loading';
  }, [hasToken, meQuery.isPending, meQuery.isError, meQuery.data]);

  // If the token turns out to be invalid/expired, fall back to signed-out.
  useEffect(() => {
    if (hasToken === true && meQuery.isError) {
      authStorage.clearToken().then(() => setHasToken(false));
    }
  }, [hasToken, meQuery.isError]);

  const value = useMemo(
    () => ({
      status,
      user: meQuery.data ?? null,
      requestCode,
      signInWithCode,
      requestPhoneCode,
      verifyPhoneCode,
      applyToken: applySession,
      devSignIn,
      signOut,
    }),
    [status, meQuery.data, requestCode, signInWithCode, requestPhoneCode, verifyPhoneCode, applySession, devSignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
