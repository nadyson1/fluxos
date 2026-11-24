import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web configuration is public client configuration. Access is enforced by Auth and Firestore Rules.
const firebaseConfig = {
  apiKey: 'AIzaSyAFbJLwsACYwqbb3o-f8bmpkvsH2Sd-iw4',
  authDomain: 'fluxos-sync.firebaseapp.com',
  projectId: 'fluxos-sync',
  storageBucket: 'fluxos-sync.firebasestorage.app',
  messagingSenderId: '432682270495',
  appId: '1:432682270495:web:c3acb2b406dbc787c6fa2a',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestore = getFirestore(firebaseApp);

let authPromise: Promise<Auth> | undefined;

export function getFirebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = Promise.resolve().then(() => {
      if (!Capacitor.isNativePlatform()) return getAuth(firebaseApp);
      try {
        return initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence });
      } catch (error) {
        if (error instanceof Error && error.message.includes('already initialized')) return getAuth(firebaseApp);
        throw error;
      }
    });
  }
  return authPromise;
}

export async function observeFirebaseUser(listener: (user: User | null) => void): Promise<() => void> {
  const auth = await getFirebaseAuth();
  return onAuthStateChanged(auth, listener);
}

export async function signInWithGoogle(): Promise<User> {
  const auth = await getFirebaseAuth();
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('O login Google não retornou um token válido. Confira a configuração SHA-1 do app Android.');
    const credential = GoogleAuthProvider.credential(idToken);
    return (await signInWithCredential(auth, credential)).user;
  }
  return (await signInWithPopup(auth, new GoogleAuthProvider())).user;
}

export async function signOutOfGoogle(): Promise<void> {
  const auth = await getFirebaseAuth();
  if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut();
  await firebaseSignOut(auth);
}

export type { User as FirebaseUser };
