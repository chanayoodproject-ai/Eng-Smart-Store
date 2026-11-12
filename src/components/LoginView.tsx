
import React, { useState, useEffect } from 'react';
import { User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, setDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { User } from '../types';
import { initialUsers } from '../data/users';
import { EngLogo } from './EngLogo';

interface LoginViewProps {
  onLogin: (user: User) => void;
}

// Build instant offline/initial users list
const getInitialDbUsers = (): User[] => {
  try {
    const cached = localStorage.getItem('warehouse_cached_users');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}

  const defaultList: User[] = initialUsers.map((u) => ({
    id: u.id,
    username: u.id,
    name: u.name,
    nickname: u.nickname,
    role: 'user',
    createdAt: '2026-08-01T00:00:00.000Z',
  }));

  defaultList.push({
    id: 'Admininmad',
    username: 'Admininmad',
    name: 'Administrator',
    role: 'admin',
    createdAt: '2026-08-01T00:00:00.000Z',
  });

  return defaultList;
};

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [loginInput, setLoginInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dbUsers, setDbUsers] = useState<User[]>(getInitialDbUsers);

  // Background silent sync: fetch fresh users and seed if necessary without blocking the UI
  useEffect(() => {
    let isMounted = true;
    const syncUsersSilently = async () => {
      if (!db) return;
      try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        let loadedUsers: User[] = [];
        const existingIds = new Set<string>();

        usersSnapshot.forEach((docSnap) => {
          existingIds.add(docSnap.id);
          loadedUsers.push(docSnap.data() as User);
        });

        const batch = [];
        let needsUpdate = false;

        // Seed missing initial users if Firestore collection is fresh
        for (const u of initialUsers) {
          if (!existingIds.has(u.id)) {
            const newUser: User = {
              id: u.id,
              username: u.id,
              name: u.name,
              nickname: u.nickname,
              role: 'user',
              createdAt: new Date().toISOString(),
            };
            batch.push(setDoc(doc(db, 'users', u.id), newUser));
            loadedUsers.push(newUser);
            needsUpdate = true;
          }
        }

        // Ensure admin exists
        if (!existingIds.has('Admininmad')) {
          const defaultAdmin: User = {
            id: 'Admininmad',
            username: 'Admininmad',
            name: 'Administrator',
            role: 'admin',
            createdAt: new Date().toISOString(),
          };
          batch.push(setDoc(doc(db, 'users', 'Admininmad'), defaultAdmin));
          loadedUsers.push(defaultAdmin);
          needsUpdate = true;
        }

        if (needsUpdate && batch.length > 0) {
          await Promise.all(batch);
        }

        if (isMounted && loadedUsers.length > 0) {
          setDbUsers(loadedUsers);
          try {
            localStorage.setItem('warehouse_cached_users', JSON.stringify(loadedUsers));
          } catch (_) {}
        }
      } catch (err) {
        console.warn('Silent users sync (offline fallback active):', err);
      }
    };

    syncUsersSilently();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = loginInput.trim().toLowerCase();

    if (!cleanInput) {
      setError('กรุณากรอกรหัสพนักงาน หรือชื่อจริง');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Find user locally from instant loaded list
      let foundUser = dbUsers.find(
        (u) =>
          u.id.toLowerCase() === cleanInput ||
          (u.username && u.username.toLowerCase() === cleanInput) ||
          u.name.toLowerCase().includes(cleanInput)
      );

      // 2. If not found in local memory, search live in Firestore doc directly
      if (!foundUser) {
        try {
          const directDoc = await getDoc(doc(db, 'users', loginInput.trim()));
          if (directDoc.exists()) {
            foundUser = directDoc.data() as User;
          } else {
            // Check by ID, username or name in collection
            const snap = await getDocs(collection(db, 'users'));
            snap.forEach((d) => {
              const u = d.data() as User;
              if (
                u.id.toLowerCase() === cleanInput ||
                (u.username && u.username.toLowerCase() === cleanInput) ||
                u.name.toLowerCase().includes(cleanInput)
              ) {
                foundUser = u;
              }
            });
          }
        } catch (_) {}
      }

const generateSafeUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (_) {}
  }
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
};

      if (foundUser) {
        // Handle persistent device lock
        let deviceId: string | null = null;
        try {
          deviceId = localStorage.getItem('device_id');
        } catch (_) {}

        if (!deviceId) {
          deviceId = generateSafeUUID();
          try {
            localStorage.setItem('device_id', deviceId);
          } catch (_) {}
        }

        // Fetch fresh user data to check if already active on another device
        const userRef = doc(db, 'users', foundUser.id);
        try {
          const userSnap = await getDoc(userRef);
          if (userSnap.exists() && foundUser.id !== 'Admininmad') {
            const freshData = userSnap.data() as User;
            if (freshData.activeDeviceId && freshData.activeDeviceId !== deviceId) {
              setError('ไม่สามารถเข้าสู่ระบบได้ เนื่องจากมีการเข้าสู่ระบบอยู่แล้ว กรุณาเข้าสู่ระบบด้วย User ของตนเอง');
              setLoading(false);
              return;
            }
          }
        } catch (_) {}

        const newToken = generateSafeUUID();
        const updateData: any = { sessionToken: newToken };
        if (foundUser.id !== 'Admininmad') {
          updateData.activeDeviceId = deviceId;
        } else {
          updateData.activeDeviceId = ''; // Never lock Admininmad
        }

        // Update active device token
        updateDoc(userRef, updateData).catch((err) => {
          console.warn('Failed to update session token in Firestore:', err);
        });

        const updatedUser = {
          ...foundUser,
          sessionToken: newToken,
          activeDeviceId: foundUser.id !== 'Admininmad' ? deviceId : '',
        };
        localStorage.setItem('warehouse_user', JSON.stringify(updatedUser));
        onLogin(updatedUser);
      } else {
        setError('ไม่พบข้อมูลผู้ใช้ในระบบ กรุณาตรวจสอบรหัสพนักงานหรือชื่อจริง');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#070b14] flex items-center justify-center p-4 sm:p-6 pl-safe pr-safe selection:bg-blue-500 selection:text-white overflow-y-auto relative">
      <div className="absolute top-[-8%] left-1/2 -translate-x-1/2 w-[520px] h-[320px] bg-blue-600/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-6%] right-[-4%] w-[380px] h-[280px] bg-orange-500/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-[-8%] w-64 h-64 bg-sky-400/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md my-auto rounded-[28px] bg-white text-slate-900 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.65)] flex flex-col p-6 sm:p-8 pt-safe-content justify-center relative overflow-hidden border border-white/70">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-blue-600 via-sky-400 to-orange-500" />

        <div className="relative z-10 flex flex-col items-center mb-5 sm:mb-6">
          <div className="w-full max-w-[500px] h-20 sm:h-[120px] flex items-center justify-center mb-3 sm:mb-4 overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-slate-800">
            <EngLogo
              alt="ENG Smart Store Logo"
              style={{ width: '500px', maxWidth: '100%', height: '100%', maxHeight: '120px' }}
              className="object-contain rounded-2xl"
            />
          </div>
          <h1
            style={{ fontSize: '22px', fontStyle: 'normal', fontFamily: "'Fredericka the Great', cursive", textDecorationLine: 'none', textAlign: 'center' }}
            className="font-bold text-slate-950 mb-1 tracking-tight"
          >
            ENG Smart Store App
          </h1>
          <p className="text-slate-500 text-sm font-medium text-center">เข้าสู่ระบบเพื่อจัดการคลังสินค้า</p>
        </div>

        {error && (
          <div className="mb-4 sm:mb-5 p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-red-700 relative z-10" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <span className="text-sm font-medium leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="relative z-10 flex flex-col gap-4 sm:gap-5">
          <div className="space-y-1.5">
            <label htmlFor="login-id" className="text-sm font-semibold text-slate-700 ml-1">รหัสพนักงาน หรือ ชื่อจริง</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-slate-400" />
              </div>
              <input
                id="login-id"
                type="text"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                className="block w-full h-14 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 focus:bg-white transition-all text-slate-950 outline-none placeholder:text-slate-400 text-base"
                placeholder="กรอกรหัสพนักงาน หรือ ชื่อจริง"
                disabled={loading}
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full h-14 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 active:scale-[0.99] disabled:opacity-70 text-white font-bold px-4 rounded-2xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span className="text-base">เข้าสู่ระบบ</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

