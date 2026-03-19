import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider, type Auth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => typeof value === 'string' && value.trim().length > 0);

let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let microsoftProvider: OAuthProvider | null = null;

if (hasFirebaseConfig) {
    try {
        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        auth = getAuth(app);
        googleProvider = new GoogleAuthProvider();
        microsoftProvider = new OAuthProvider('microsoft.com');
        googleProvider.setCustomParameters({ prompt: 'select_account' });
        microsoftProvider.setCustomParameters({ prompt: 'select_account' });
    } catch (error) {
        console.error('Firebase initialization failed; OAuth buttons will be disabled.', error);
    }
} else {
    console.warn('Firebase environment variables are missing; OAuth buttons are disabled.');
}

export const isFirebaseConfigured = Boolean(auth && googleProvider && microsoftProvider);

export { auth, googleProvider, microsoftProvider };
