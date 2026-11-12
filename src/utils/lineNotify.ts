import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LineNotificationConfig, LineStockNotifyData, LineBulkStockNotifyData, LineAuthNotifyData, PurchaseOrder } from '../types';

export const DEFAULT_LINE_CONFIG: LineNotificationConfig = {
  enabled: true,
  channelAccessToken: '9Q8ELV/INC2ERe2iG4ynfet8R8KnAygHHxgaGlPH6iCEX5/Ix5s/t7UORE+UftHLMQcsmL5fRu1OVBBBjDlBvXkAEPLpTjKnN9Osq7xgOw3ZKurF7kbu8HvVdP6NesC/RlkcyCLjSJV0L7puMiVlSwdB04t89/1O/w1cDnyilFU=',
  destinationId: 'Ud3217b5c26f2624b19c6f7eae5ab209c',
  notifyStockOut: true,
  notifyStockIn: true,
  notifyLogin: false,
  notifyLogout: false,
  notifyLowStock: true,
  notifyPurchaseOrder: true,
  useSeparateOrderDestination: true,
  purchaseOrderDestinationId: 'U02c89d2e8c0a7eea3cada8e1c2bcf814',
  purchaseOrderChannelAccessToken: 'ANHC/PZy9Vwxau92pp0xGa3+RofwsQQKxceHGZT9cA4xd20gRPrXnWC00OPsKOTIP/rV/6HgeOcDcbig2DDcJlvYzlxlO5Zqh5v1EmCLyqnnDHAGz6Posp3850I7XRLRa8moPnCef1XqSeN9D1GlcAdB04t89/1O/w1cDnyilFU=',
};

// Cache config in memory for fast synchronous checks
let cachedConfig: LineNotificationConfig | null = null;

export const getLineConfig = async (): Promise<LineNotificationConfig> => {
  if (cachedConfig) return cachedConfig;
  try {
    const docRef = doc(db, 'settings', 'line_config');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      cachedConfig = { ...DEFAULT_LINE_CONFIG, ...(snap.data() as LineNotificationConfig) };
      return cachedConfig;
    }
  } catch (err) {
    console.warn('Failed to fetch LINE config from Firestore:', err);
  }
  return DEFAULT_LINE_CONFIG;
};

export const saveLineConfig = async (
  config: Partial<LineNotificationConfig>, 
  updatedBy?: string,
  userRole: string = 'admin'
): Promise<LineNotificationConfig> => {
  const current = await getLineConfig();
  const updated: LineNotificationConfig = {
    ...current,
    ...config,
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };
  cachedConfig = updated;

  try {
    const docRef = doc(db, 'settings', 'line_config');
    await setDoc(docRef, updated, { merge: true });
  } catch (err) {
    console.error('Failed to save LINE config to Firestore:', err);
    throw err;
  }

  // Also sync to backend server if needed with role authorization
  try {
    await fetch('/api/line/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updated, userRole }),
    });
  } catch (_) {}

  return updated;
};

/**
 * Send LINE notification for Stock In / Stock Out
 */
export const notifyStockTransaction = async (data: LineStockNotifyData): Promise<{ success: boolean; message?: string }> => {
  try {
    const payload = {
      type: data.type === 'in' ? 'stock_in' : 'stock_out',
      data: {
        ...data,
        timestamp: data.timestamp || new Date().toLocaleString('th-TH', { 
          timeZone: 'Asia/Bangkok', 
          dateStyle: 'medium', 
          timeStyle: 'short' 
        }),
      },
    };

    const res = await fetch('/api/line/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, message: 'บริการแจ้งเตือน LINE ไม่พร้อมบนโฮสต์นี้' };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || 'Failed to send LINE notification' };
    }

    const resData = await res.json();
    return { success: resData.success, message: resData.message };
  } catch (err: any) {
    console.warn('LINE stock notify error:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Send LINE notification for Bulk Stock Out
 */
export const notifyBulkStockTransaction = async (data: LineBulkStockNotifyData): Promise<{ success: boolean; message?: string }> => {
  try {
    const payload = {
      type: 'bulk_stock_out',
      data: {
        ...data,
        timestamp: data.timestamp || new Date().toLocaleString('th-TH', { 
          timeZone: 'Asia/Bangkok', 
          dateStyle: 'medium', 
          timeStyle: 'short' 
        }),
      },
    };

    const res = await fetch('/api/line/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const bulkType = res.headers.get('content-type') || '';
    if (!bulkType.includes('application/json')) {
      return { success: false, message: 'บริการแจ้งเตือน LINE ไม่พร้อมบนโฮสต์นี้' };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || 'Failed to send LINE bulk notification' };
    }

    const resData = await res.json();
    return { success: resData.success, message: resData.message };
  } catch (err: any) {
    console.warn('LINE bulk stock notify error:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Send LINE notification for User Login / Logout
 */
export const notifyAuthEvent = async (data: LineAuthNotifyData): Promise<{ success: boolean; message?: string }> => {
  try {
    const payload = {
      type: data.type,
      data: {
        ...data,
        timestamp: data.timestamp || new Date().toLocaleString('th-TH', { 
          timeZone: 'Asia/Bangkok', 
          dateStyle: 'medium', 
          timeStyle: 'short' 
        }),
      },
    };

    const res = await fetch('/api/line/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const authType = res.headers.get('content-type') || '';
    if (!authType.includes('application/json')) {
      return { success: false, message: 'บริการแจ้งเตือน LINE ไม่พร้อมบนโฮสต์นี้' };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || 'Failed to send LINE notification' };
    }

    const resData = await res.json();
    return { success: resData.success, message: resData.message };
  } catch (err: any) {
    console.warn('LINE auth notify error:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Test LINE notification
 */
export const testLineNotification = async (testConfig?: { 
  channelAccessToken?: string; 
  destinationId?: string;
  isOrderTest?: boolean;
}): Promise<{ success: boolean; error?: string; message?: string }> => {
  try {
    const res = await fetch('/api/line/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testConfig || {}),
    });

    const testType = res.headers.get('content-type') || '';
    if (!testType.includes('application/json')) {
      return { success: false, error: 'บริการแจ้งเตือน LINE ไม่พร้อมบนโฮสต์นี้' };
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'การส่งข้อความทดสอบไม่สำเร็จ กรุณาตรวจสอบ Token และ ID' };
    }

    return { success: true, message: data.message || 'ส่งข้อความทดสอบไปยัง LINE สำเร็จเรียบร้อยแล้ว' };
  } catch (err: any) {
    return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์' };
  }
};

/**
 * Send LINE notification for Purchase Order (การสั่งซื้อสินค้าใกล้หมด/หมด)
 */
export const notifyPurchaseOrder = async (order: PurchaseOrder, baseUrl?: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const payload = {
      type: 'purchase_order',
      data: {
        order,
        baseUrl: baseUrl || window.location.origin,
      },
    };

    const res = await fetch('/api/line/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const orderType = res.headers.get('content-type') || '';
    if (!orderType.includes('application/json')) {
      return { success: false, message: 'บริการแจ้งเตือน LINE ไม่พร้อมบนโฮสต์นี้' };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || 'Failed to send LINE order notification' };
    }

    const resData = await res.json();
    return { success: resData.success, message: resData.message };
  } catch (err: any) {
    console.warn('LINE purchase order notify error:', err);
    return { success: false, message: err.message };
  }
};
