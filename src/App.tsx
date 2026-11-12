import { db } from './firebase';
import { collection, query, orderBy, limit, getDocs, setDoc, doc, deleteDoc, getDoc, onSnapshot, updateDoc, writeBatch, runTransaction } from 'firebase/firestore';
import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryItem, InventorySummary, ChatMessage, RequisitionRecord, DbActionPayload, PurchaseOrder } from './types';
import { ItemCard } from './components/ItemCard';
import { ItemDetailModal } from './components/ItemDetailModal';
import { MobileNavbar, AppTab } from './components/MobileNavbar';
import { VoiceAssistantView } from './components/VoiceAssistantView';
import { StatsDashboard } from './components/StatsDashboard';
import { CategoryView } from './components/CategoryView';
import { Toast, ToastMessage } from './components/Toast';
import { RequisitionView } from './components/RequisitionView';
import { RequisitionModal } from './components/RequisitionModal';
import { BulkRequisitionModal, BulkRequisitionSubmitData } from './components/BulkRequisitionModal';
import { BatchUpdateModal, BatchUpdatePayload } from './components/BatchUpdateModal';
import { EditItemModal } from './components/EditItemModal';
import { EditRequisitionModal } from './components/EditRequisitionModal';
import { CreateOrderModal } from './components/CreateOrderModal';
import { OrdersManagementView } from './components/OrdersManagementView';
import { InvoiceScanModal } from './components/InvoiceScanModal';
import { LoginView } from './components/LoginView';
import { UserManagementView } from './components/UserManagementView';
import { AdminHubView } from './components/AdminHubView';
import { ThemeToggle } from './components/ThemeToggle';
import { EngLogo } from './components/EngLogo';
import { TopNavTabs } from './components/TopNavTabs';
import { ModalPortal } from './components/ModalPortal';
import { GlobalProgressBar } from './components/GlobalProgressBar';
import { InventorySkeleton } from './components/InventorySkeleton';
import { 
  Package, Search, RefreshCw, Filter, ClipboardList, Plus,
  AlertTriangle, CheckCircle2, XCircle, Bot, X, FileDown, Loader2, LogOut, User as UserIcon, Bell,
  BarChart3, Layers, Users, CheckSquare, Zap, Check, ChevronDown, ShoppingCart, Star, SlidersHorizontal
} from 'lucide-react';
import { generateAndDownloadPdf, parseRecordDateTime } from './utils/pdfGenerator';
import { useGeolocationAuth } from './hooks/useGeolocationAuth';
import { GeoConfig, getSavedGeoConfig, saveGeoConfig, subscribeGeoConfig, getSavedGeoLocationEnabled, saveGeoLocationSetting, subscribeGeoLocationSetting } from './utils/geo';
import { GeoRestrictionModal } from './components/GeoRestrictionModal';
import { TransactionSuccessModal, TransactionSuccessData } from './components/TransactionSuccessModal';
import { playSuccessSoundAndSpeak } from './utils/audioUtils';
import { notifyStockTransaction, notifyBulkStockTransaction, notifyAuthEvent, notifyPurchaseOrder } from './utils/lineNotify';
import { triggerLowStockPush, triggerImportantRequisitionPush } from './utils/webPush';
import { LineSettingsModal } from './components/LineSettingsModal';
import { FontSettingsModal } from './components/FontSettingsModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { User } from './types';
import { useDeviceDetector } from './hooks/useDeviceDetector';
import { useScrollLock } from './hooks/useScrollLock';
import { INITIAL_REQUISITION_LOGS, INVENTORY_QTY_OVERRIDES } from './data/initialData';

const DATA_SYNC_VERSION = '2026-10-12-report-v1';

// Helper function to strip undefined values so Firestore never errors on setDoc
function cleanForFirestore<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

// Apply inventory quantity overrides from the official report
function applyInventoryOverrides(itemsList: InventoryItem[]): InventoryItem[] {
  return itemsList.map((item) => {
    const cleanId = (item.id || '').trim();
    const hasBeenUpdated = Boolean(item.lastUpdated);
    const overrideQty = !hasBeenUpdated ? INVENTORY_QTY_OVERRIDES[cleanId] : undefined;
    const qty = overrideQty !== undefined ? overrideQty : (Number(item.qty) || 0);
    const minStock = Number(item.minStock) || 1;
    let status: 'normal' | 'low' | 'out' = 'normal';
    if (qty <= 0) status = 'out';
    else if (qty <= minStock) status = 'low';

    return {
      ...item,
      id: cleanId,
      qty,
      minStock,
      status,
      outOfStockDate: qty > 0 ? '' : (item.outOfStockDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    };
  });
}

// Helper to get deleted requisition IDs so deleted initial records do not reappear
function getDeletedRequisitionIds(): Set<string> {
  try {
    const saved = localStorage.getItem('warehouse_deleted_req_ids');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch (_) {}
  return new Set<string>();
}

// Generate next clean sequential requisition ID (e.g., 1081, 1082, ...)
function getNextRequisitionId(existingRecords: RequisitionRecord[], offset = 0): string {
  let maxId = 1080;
  for (const r of existingRecords) {
    const clean = (r.id || '').replace(/^REQ-?(?:IN-?)?/i, '');
    const num = parseInt(clean, 10);
    // Track sequential 4-5 digit IDs (1001..99999)
    if (!isNaN(num) && num >= 1001 && num < 100000 && num > maxId) {
      maxId = num;
    }
  }
  return String(maxId + 1 + offset);
}

// Merge historical requisition logs (1001-1080) with any additional or edited records
function mergeWithInitialRequisitions(recordsList: RequisitionRecord[]): RequisitionRecord[] {
  const deletedIds = getDeletedRequisitionIds();
  const map = new Map<string, RequisitionRecord>();
  for (const rec of INITIAL_REQUISITION_LOGS) {
    const cleanId = (rec.id || '').replace(/^REQ-?(?:IN-?)?/i, '');
    if (!deletedIds.has(cleanId)) {
      map.set(cleanId, { ...rec, id: cleanId });
    }
  }
  for (const rec of recordsList) {
    const cleanId = (rec.id || '').replace(/^REQ-?(?:IN-?)?/i, '');
    if (!deletedIds.has(cleanId)) {
      // Allow newer/edited records from Firestore or local state to update or add to initial records
      map.set(cleanId, { ...rec, id: cleanId });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const timeA = new Date(a.isoDate).getTime();
    const timeB = new Date(b.isoDate).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
      return numB - numA;
    }
    return 0;
  });
}

// Initial state helpers for instant 0ms load time
const getInitialInventory = (): InventoryItem[] => {
  try {
    const isCurrentVersion = localStorage.getItem('warehouse_data_version') === DATA_SYNC_VERSION;
    const cached = localStorage.getItem('warehouse_inventory');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return isCurrentVersion ? parsed : applyInventoryOverrides(parsed);
      }
    }
  } catch (_) {}
  return [];
};

const getInitialSummary = (): InventorySummary | null => {
  try {
    if (localStorage.getItem('warehouse_data_version') !== DATA_SYNC_VERSION) return null;
    const cached = localStorage.getItem('warehouse_summary');
    if (cached) return JSON.parse(cached);
  } catch (_) {}
  return null;
};

const getInitialRequisitions = (): RequisitionRecord[] => {
  try {
    const saved = localStorage.getItem('warehouse_requisitions');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return mergeWithInitialRequisitions(parsed);
      }
    }
  } catch (_) {}
  return INITIAL_REQUISITION_LOGS;
};

const getInitialUser = (): User | null => {
  try {
    const saved = localStorage.getItem('warehouse_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.id) return parsed;
    }
  } catch (_) {}
  return null;
};

const getInitialOrders = (): PurchaseOrder[] => {
  try {
    const saved = localStorage.getItem('warehouse_orders');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
};

export default function App() {
  const deviceInfo = useDeviceDetector();
  const [currentUser, setCurrentUser] = useState<User | null>(getInitialUser);
  const [orders, setOrders] = useState<PurchaseOrder[]>(getInitialOrders);
  const [orderModalItem, setOrderModalItem] = useState<InventoryItem | null>(null);
  const [isCreateOrderModalOpen, setIsCreateOrderModalOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const pendingOrdersCount = useMemo(() => orders.filter(o => o.status === 'pending').length, [orders]);
  const [geoConfig, setGeoConfig] = useState<GeoConfig>(getSavedGeoConfig);
  const isGeoLocationEnabled = geoConfig.isGeoLocationEnabled;

  // Subscribe to real-time Geo Location settings from Firestore (Admin master setting)
  useEffect(() => {
    const unsub = subscribeGeoConfig((config) => {
      setGeoConfig(config);
    });
    return () => unsub();
  }, []);

  const {
    verifyLocation,
    isCheckingGeo,
    checkInitialLocation,
    geoModalState,
    closeGeoModal,
    recheckLocation,
  } = useGeolocationAuth(currentUser, geoConfig);
  
  // Check location on initial login/load
  useEffect(() => {
    if (currentUser && geoConfig.isGeoLocationEnabled) {
      checkInitialLocation();
    }
  }, [currentUser, checkInitialLocation, geoConfig.isGeoLocationEnabled]);

  const [items, setItems] = useState<InventoryItem[]>(getInitialInventory);
  const [summary, setSummary] = useState<InventorySummary | null>(getInitialSummary);
  const [loading, setLoading] = useState(() => getInitialInventory().length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Navigation tab state (supports ?tab=orders, ?tab=history, etc. from LINE / Web Push deep links)
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as AppTab | null;
      const validTabs: AppTab[] = ['inventory', 'categories', 'orders', 'history', 'dashboard', 'voice', 'users', 'admin'];
      if (tabParam && validTabs.includes(tabParam)) {
        return tabParam;
      }
    } catch (_) {}
    return 'inventory';
  });

  const [dbErrorAlert, setDbErrorAlert] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    setToasts(prev => [{ ...toast, id: Date.now().toString() + Math.random() }, ...prev]);
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));
  // Alert state
  const [showLowStockAlert, setShowLowStockAlert] = useState(false);
  const [hasShownAlert, setHasShownAlert] = useState(false);
  const [isExportingInventoryPdf, setIsExportingInventoryPdf] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<string>('ทั้งหมด');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'low_or_out' | 'favorites'>('all');

  // Favorite items state (persisted per user)
  const [favoriteItemIds, setFavoriteItemIds] = useState<Set<string>>(() => {
    try {
      const savedUser = localStorage.getItem('warehouse_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      const userKey = user?.id || user?.username ? `warehouse_favorites_${user.id || user.username}` : 'warehouse_favorites_default';
      const saved = localStorage.getItem(userKey) || localStorage.getItem('warehouse_favorites');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse favorites:', e);
    }
    return new Set<string>();
  });

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isBulkRequisitionModalOpen, setIsBulkRequisitionModalOpen] = useState(false);
  const [isBatchUpdateModalOpen, setIsBatchUpdateModalOpen] = useState(false);

  // Requisition history state with localStorage
  const [requisitions, setRequisitions] = useState<RequisitionRecord[]>(getInitialRequisitions);

  // Modals state
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [isRequisitionModalOpen, setIsRequisitionModalOpen] = useState(false);
  const [itemForRequisition, setItemForRequisition] = useState<InventoryItem | null>(null);
  const [itemToEdit, setItemToEdit] = useState<InventoryItem | null>(null);
  const [isEditItemModalOpen, setIsEditItemModalOpen] = useState(false);
  const [requisitionToEdit, setRequisitionToEdit] = useState<RequisitionRecord | null>(null);
  const [isEditRequisitionModalOpen, setIsEditRequisitionModalOpen] = useState(false);
  const [isLineSettingsModalOpen, setIsLineSettingsModalOpen] = useState(false);
  const [lineSettingsInitialTab, setLineSettingsInitialTab] = useState<'webpush' | 'line'>('line');
  const [transactionSuccess, setTransactionSuccess] = useState<TransactionSuccessData | null>(null);

  // App typography font selection state (IBM Plex Sans Thai / Prompt / Kanit / Chakra Petch / Mitr / Sarabun)
  const [currentFont, setCurrentFont] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('app-font-family');
      if (saved && saved !== 'prompt') {
        return saved;
      }
      return 'ibm-plex';
    } catch {
      return 'ibm-plex';
    }
  });
  const [isFontModalOpen, setIsFontModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-font', currentFont);
    try {
      localStorage.setItem('app-font-family', currentFont);
    } catch (e) {}
  }, [currentFont]);

  const handleSelectFont = (fontId: string) => {
    setCurrentFont(fontId);
  };

  const handleOpenAddItemModal = () => {
    setItemToEdit({
      id: `A${Date.now().toString().slice(-9)}`,
      name: '',
      category: categoryList[0] || 'เคมี',
      unit: 'ชิ้น',
      qty: 0,
      minStock: 5,
      location: 'Store FL.6',
      note: '',
      ordered: '',
      orderedDate: '',
      status: 'out',
    });
    setIsEditItemModalOpen(true);
  };
  
  const [isRequisitionMenuOpen, setIsRequisitionMenuOpen] = useState(false);
  const requisitionMenuRef = useRef<HTMLDivElement>(null);

  // Close requisition menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (requisitionMenuRef.current && !requisitionMenuRef.current.contains(event.target as Node)) {
        setIsRequisitionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenRequisitionModal = async (item?: InventoryItem | null) => {
    const isAllowed = await verifyLocation();
    if (isAllowed) {
      setItemForRequisition(item || null);
      setIsRequisitionModalOpen(true);
    }
  };

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useScrollLock(Boolean(dbErrorAlert || showLowStockAlert || showLogoutConfirm || isBulkRequisitionModalOpen));

  // AI Chat State (Text only)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [pendingQuery, setPendingQuery] = useState('');
  const [isLiveActive, setIsLiveActive] = useState(false);

  // Recalculate summary stats helper
  const recalculateSummary = (itemsList: InventoryItem[]): InventorySummary => {
    const categoryMap = new Map();
    itemsList.forEach((item) => {
      const cat = item.category || 'ทั่วไป';
      const current = categoryMap.get(cat) || { count: 0, totalQty: 0 };
      current.count += 1;
      current.totalQty += Number(item.qty) || 0;
      categoryMap.set(cat, current);
    });

    const newSummary: InventorySummary = {
      totalItems: itemsList.length,
      totalQty: itemsList.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
      lowStockCount: itemsList.filter((i) => i.status === 'low').length,
      outOfStockCount: itemsList.filter((i) => i.status === 'out').length,
      categories: Array.from(categoryMap.entries()).map(([name, stats]) => ({
        name,
        ...stats,
      })),
      locations: [],
      lastUpdated: new Date().toISOString(),
    };

    setSummary(newSummary);
    try {
      localStorage.setItem('warehouse_summary', JSON.stringify(newSummary));
    } catch (_) {}
    return newSummary;
  };

  // Persist requisitions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('warehouse_requisitions', JSON.stringify(requisitions));
    } catch (e) {
      console.warn('Failed to save requisitions to localStorage:', e);
    }
  }, [requisitions]);

  // Fetch Requisitions Data from Firestore
  const fetchRequisitions = async () => {
    if (!db) return;
    try {
      const q = query(collection(db, 'requisitions'), orderBy('isoDate', 'desc'), limit(500));
      const querySnapshot = await getDocs(q);

      if (querySnapshot && !querySnapshot.empty) {
        const data = querySnapshot.docs.map(d => {
          const req = d.data() as RequisitionRecord;
          return {
            ...req,
            id: (req.id || d.id).replace(/^REQ-?/i, ''),
          };
        });
        if (data.length > 0) {
          const merged = mergeWithInitialRequisitions(data);
          setRequisitions(merged);
          try {
            localStorage.setItem('warehouse_requisitions', JSON.stringify(merged));
          } catch (_) {}
          return;
        }
      }
    } catch (err) {
      console.warn('Error fetching requisitions from Firestore, loading local fallback:', err);
    }
  };

  // Fetch Inventory Data from Firestore / backend
  const fetchInventory = async (forceRefresh = false) => {
    try {
      if (forceRefresh) setRefreshing(true);
      setError('');

      let inventoryData: InventoryItem[] = [];
      const needsReportSync = localStorage.getItem('warehouse_data_version') !== DATA_SYNC_VERSION;

      // 1. Fetch from Firestore (Source of Truth)
      if (db && !needsReportSync) {
        try {
          const snapshot = await getDocs(collection(db, 'inventory'));
          if (snapshot && !snapshot.empty) {
            inventoryData = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as InventoryItem;
              const qty = Number(data.qty) || 0;
              const minStock = Number(data.minStock) || 1;
              let status: 'normal' | 'low' | 'out' = data.status || 'normal';
              if (qty <= 0) status = 'out';
              else if (qty <= minStock) status = 'low';

              return {
                ...data,
                qty,
                minStock,
                status,
                outOfStockDate: data.outOfStockDate || (qty <= 0 ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : '')
              };
            });
          }
        } catch (firestoreErr) {
          console.warn('Firestore fetch error:', firestoreErr);
        }
      }

      // 2. If Firestore is empty or needs report sync, fetch from server
      if (inventoryData.length === 0) {
        try {
          const res = await fetch(`/api/inventory`);
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = await res.json();
            inventoryData = applyInventoryOverrides(data.items || []);
          }
        } catch (apiErr) {
          console.warn('API inventory fetch failed:', apiErr);
        }
      }

      if (inventoryData.length > 0) {
        if (needsReportSync) {
          inventoryData = applyInventoryOverrides(inventoryData);
          try {
            localStorage.setItem('warehouse_data_version', DATA_SYNC_VERSION);
          } catch (_) {}

          // Seed updated inventory and full 80 requisition history records into Firestore
          if (db) {
            (async () => {
              try {
                const invBatch = writeBatch(db);
                for (const it of inventoryData) {
                  invBatch.set(doc(db, 'inventory', it.id), cleanForFirestore(it));
                }
                await invBatch.commit();

                const reqBatch = writeBatch(db);
                for (const rec of INITIAL_REQUISITION_LOGS) {
                  reqBatch.set(doc(db, 'requisitions', rec.id), cleanForFirestore(rec));
                }
                await reqBatch.commit();
              } catch (seedErr) {
                console.warn('Firestore initial report sync warning:', seedErr);
              }
            })();
          }
        }

        const calculatedSummary = recalculateSummary(inventoryData);
        setItems(inventoryData);
        
        try {
          localStorage.setItem('warehouse_inventory', JSON.stringify(inventoryData));
        } catch (_) {}
        
        // Trigger low stock alert if needed
        if (calculatedSummary && (calculatedSummary.lowStockCount > 0 || calculatedSummary.outOfStockCount > 0)) {
          if (!hasShownAlert) {
            setShowLowStockAlert(true);
            setHasShownAlert(true);
          }
        }
      } else {
        // Fallback to local cache if offline
        const cached = getInitialInventory();
        if (cached.length > 0) {
          setItems(cached);
          const cachedSum = getInitialSummary() || recalculateSummary(cached);
          setSummary(cachedSum);
        }
      }
      
      fetchRequisitions().catch(console.warn);
    } catch (err: any) {
      console.error('Error fetching inventory:', err);
      if (items.length === 0) {
        setError(err.message || 'ไม่สามารถโหลดข้อมูลจาก Store Data ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Check for saved user session
    const savedUser = localStorage.getItem('warehouse_user');
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (e) {}
    }
    fetchInventory();

    // Real-time Firestore Listeners (Defensive guards to guarantee zero crash)
    let unsubInventory = () => {};
    let unsubReqs = () => {};
    let unsubOrders = () => {};

    if (db) {
      try {
        unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
          if (!snapshot.empty) {
            const realTimeItems: InventoryItem[] = snapshot.docs.map(docSnap => {
              const data = docSnap.data() as InventoryItem;
              const qty = Number(data.qty) || 0;
              const minStock = Number(data.minStock) || 1;
              let status: 'normal' | 'low' | 'out' = data.status || 'normal';
              if (qty <= 0) status = 'out';
              else if (qty <= minStock) status = 'low';

              return {
                ...data,
                qty,
                minStock,
                status,
                outOfStockDate: data.outOfStockDate || (qty <= 0 ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : '')
              };
            });

            if (realTimeItems.length > 0) {
              setItems(realTimeItems);
              recalculateSummary(realTimeItems);
              try {
                localStorage.setItem('warehouse_inventory', JSON.stringify(realTimeItems));
              } catch (_) {}
              setLoading(false);
            }
          }
        }, (err) => {
          console.warn('Real-time inventory snapshot warning:', err);
        });
      } catch (err) {
        console.warn('Could not attach inventory listener:', err);
      }

      try {
        const qReqs = query(collection(db, 'requisitions'), orderBy('isoDate', 'desc'), limit(500));
        unsubReqs = onSnapshot(qReqs, (snapshot) => {
          if (!snapshot.empty) {
            const realTimeReqs = snapshot.docs.map(d => {
              const req = d.data() as RequisitionRecord;
              return {
                ...req,
                id: (req.id || d.id).replace(/^REQ-?/i, '')
              };
            });
            const merged = mergeWithInitialRequisitions(realTimeReqs);
            setRequisitions(merged);
            try {
              localStorage.setItem('warehouse_requisitions', JSON.stringify(merged));
            } catch (_) {}
          }
        }, (err) => {
          console.warn('Real-time requisitions snapshot warning:', err);
        });
      } catch (err) {
        console.warn('Could not attach requisitions listener:', err);
      }

      try {
        const qOrders = query(collection(db, 'orders'), orderBy('isoDate', 'desc'), limit(200));
        unsubOrders = onSnapshot(qOrders, (snapshot) => {
          if (!snapshot.empty) {
            const realTimeOrders: PurchaseOrder[] = [];
            snapshot.forEach(d => {
              realTimeOrders.push(d.data() as PurchaseOrder);
            });
            setOrders(realTimeOrders);
            try {
              localStorage.setItem('warehouse_orders', JSON.stringify(realTimeOrders));
            } catch (_) {}
          }
        }, (err) => {
          console.warn('Real-time orders snapshot warning:', err);
        });
      } catch (err) {
        console.warn('Could not attach orders listener:', err);
      }
    }

    return () => {
      unsubInventory();
      unsubReqs();
      unsubOrders();
    };
  }, []);

  // Real-time listener for device lock and role changes
  useEffect(() => {
    if (!currentUser) return;

    const deviceId = localStorage.getItem('device_id');
    const userRef = doc(db, 'users', currentUser.id);
    const unsubscribe = onSnapshot(
      userRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data() as User;
          
          // 1. Check if device lock changed to another device (Skip for Admininmad and admins)
          if (currentUser.role !== 'admin' && userData.activeDeviceId && deviceId && userData.activeDeviceId !== deviceId) {
            addToast({
              type: 'error',
              title: 'แจ้งเตือนระบบ',
              message: 'บัญชีนี้ถูกเข้าสู่ระบบจากเครื่องอื่น หรือผู้ดูแลระบบได้ปลดล็อกบัญชีของคุณ',
            });
            localStorage.removeItem('warehouse_user');
            setChatHistory([]);
            setCurrentUser(null);
            return;
          }

          // 2. Check Role changes
          if (userData.role !== currentUser.role) {
            const updatedUser = { ...currentUser, role: userData.role };
            setCurrentUser(updatedUser);
            localStorage.setItem('warehouse_user', JSON.stringify(updatedUser));
          }
        }
      },
      (error) => {
        console.warn('Firestore user snapshot listener warning:', error);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.id, currentUser?.sessionToken, currentUser?.role]);

  // Sync favorites when currentUser changes
  useEffect(() => {
    try {
      const userKey = currentUser?.id || currentUser?.username 
        ? `warehouse_favorites_${currentUser.id || currentUser.username}` 
        : 'warehouse_favorites_default';
      const saved = localStorage.getItem(userKey) || localStorage.getItem('warehouse_favorites');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setFavoriteItemIds(new Set(parsed));
        }
      } else {
        setFavoriteItemIds(new Set());
      }

      if (currentUser?.id) {
        getDoc(doc(db, 'users', currentUser.id)).then(snap => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data.favorites)) {
              setFavoriteItemIds(new Set(data.favorites));
              localStorage.setItem(userKey, JSON.stringify(data.favorites));
            }
          }
        }).catch(err => console.warn('Could not load user favorites from DB:', err));
      }
    } catch (e) {
      console.warn('Failed to sync favorites with user:', e);
    }
  }, [currentUser?.id, currentUser?.username]);

  const handleUpdateCurrentUser = (updated: User) => {
    setCurrentUser(updated);
    try {
      localStorage.setItem('warehouse_user', JSON.stringify(updated));
    } catch (_) {}
  };

  // Handle New Requisition / Stock In submission (0ms Optimistic Update)
  const handleAddRequisition = async (recordData: Omit<RequisitionRecord, 'id'>) => {
    const nextId = getNextRequisitionId(requisitions);
    const newRecord: RequisitionRecord = cleanForFirestore({
      ...recordData,
      id: nextId,
      isoDate: recordData.isoDate || new Date().toISOString(),
    });

    try {
      // 1. Instantly update requisition logs in memory (0ms)
      setRequisitions((prev) => {
        const updated = [newRecord, ...prev];
        try {
          localStorage.setItem('warehouse_requisitions', JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });

      // 2. Find target item and immediately update inventory in memory (0ms)
      const currentItem = items.find((item) => item.id === recordData.itemId);
      if (currentItem) {
        const isStockIn = recordData.type === 'in';
        const newQty = isStockIn 
          ? Number(currentItem.qty) + Number(recordData.qty) 
          : Math.max(0, Number(currentItem.qty) - Number(recordData.qty));

        let newStatus: 'normal' | 'low' | 'out' = 'normal';
        if (newQty <= 0) newStatus = 'out';
        else if (newQty <= currentItem.minStock) newStatus = 'low';

        const updatedItem: InventoryItem = cleanForFirestore({
          ...currentItem,
          qty: newQty,
          status: newStatus,
          lastUpdated: new Date().toISOString(),
          ...(newStatus === 'out' 
            ? { outOfStockDate: currentItem.outOfStockDate || new Date().toISOString() } 
            : {})
        });

        // Instant UI & state update
        const updatedList = items.map((i) => (i.id === updatedItem.id ? updatedItem : i));
        setItems(updatedList);
        recalculateSummary(updatedList);

        try {
          localStorage.setItem('warehouse_inventory', JSON.stringify(updatedList));
        } catch (_) {}

        if (selectedItem?.id === updatedItem.id) {
          setSelectedItem(updatedItem);
        }

        // Show Transaction Success Pop Up Modal
        setTransactionSuccess({
          type: recordData.type,
          itemId: updatedItem.id,
          itemName: updatedItem.name,
          category: updatedItem.category,
          qty: recordData.qty,
          unit: updatedItem.unit,
          requestedBy: recordData.requestedBy,
          purpose: recordData.purpose,
          timestamp: newRecord.timestamp,
          previousQty: currentItem.qty,
          newQty: newQty,
        });

        addToast({
          type: 'success',
          title: isStockIn ? 'รับเข้าสินค้าสำเร็จ' : 'เบิกสินค้าสำเร็จ',
          message: `${isStockIn ? 'รับเข้า' : 'เบิก'} ${updatedItem.name} จำนวน ${recordData.qty} ${updatedItem.unit} (คงเหลือ: ${newQty} ${updatedItem.unit})`,
        });

        // 3. Persist to Firestore asynchronously in background (Non-blocking)
        Promise.all([
          setDoc(doc(db, 'requisitions', newRecord.id), newRecord),
          setDoc(doc(db, 'inventory', updatedItem.id), updatedItem)
        ]).catch(err => console.error("Background Firestore sync error:", err));

        // 4. Send Real-time LINE Notification (Non-blocking background trigger)
        notifyStockTransaction({
          type: recordData.type,
          itemId: updatedItem.id,
          itemName: updatedItem.name,
          category: updatedItem.category,
          qty: recordData.qty,
          unit: updatedItem.unit,
          location: updatedItem.location,
          requestedBy: recordData.requestedBy,
          purpose: recordData.purpose,
          note: recordData.note,
          previousQty: currentItem.qty,
          newQty: newQty,
          status: newStatus,
          timestamp: newRecord.timestamp,
        }).catch(err => console.warn("LINE stock notification notice:", err));

        // 5. Send Web Push Notifications (Low stock alert or Important Requisition alert)
        if (newQty <= (updatedItem.minStock || 5) || newStatus === 'low' || newStatus === 'out') {
          triggerLowStockPush(updatedItem, newQty).catch(err => console.warn("Web Push low stock warning:", err));
        }
        if (recordData.type === 'out') {
          const isImportant = recordData.qty >= 5 || (recordData.purpose && (
            recordData.purpose.includes('ด่วน') || 
            recordData.purpose.includes('สำคัญ') || 
            recordData.purpose.includes('ฉุกเฉิน') || 
            recordData.purpose.includes('เครื่อง') || 
            recordData.purpose.includes('ระบบ')
          ));
          triggerImportantRequisitionPush({
            itemId: updatedItem.id,
            itemName: updatedItem.name,
            qty: recordData.qty,
            unit: updatedItem.unit,
            requestedBy: recordData.requestedBy,
            purpose: recordData.purpose,
            newQty,
            isImportant: Boolean(isImportant),
          }).catch(err => console.warn("Web Push requisition warning:", err));
        }
      } else {
        setDoc(doc(db, 'requisitions', newRecord.id), newRecord).catch(console.error);
      }
    } catch (err) {
      console.error("Failed to add requisition:", err);
      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง',
      });
    }
  };

  // Admin Item editing & deletion handlers
  const handleSaveEditedItem = async (updatedItem: InventoryItem, oldId?: string) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลสินค้าได้',
      });
      return;
    }

    try {
      const cleanItem = cleanForFirestore(updatedItem);
      if (oldId && oldId !== cleanItem.id) {
        await deleteDoc(doc(db, 'inventory', oldId));
      }
      await setDoc(doc(db, 'inventory', cleanItem.id), cleanItem);

      setItems((prev) => {
        const targetId = oldId || cleanItem.id;
        const exists = prev.some((i) => i.id === targetId);
        const newList = exists 
          ? prev.map((i) => (i.id === targetId ? cleanItem : i))
          : [cleanItem, ...prev];
        recalculateSummary(newList);
        try {
          localStorage.setItem('warehouse_inventory', JSON.stringify(newList));
        } catch (_) {}
        return newList;
      });

      if (selectedItem && (selectedItem.id === oldId || selectedItem.id === cleanItem.id)) {
        setSelectedItem(cleanItem);
      }

      addToast({
        type: 'success',
        title: 'บันทึกสำเร็จ',
        message: `แก้ไขข้อมูลสินค้า ${cleanItem.name} (${cleanItem.id}) เรียบร้อยแล้ว`,
      });
    } catch (err) {
      console.error('Error updating item:', err);
      throw err;
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบสินค้าได้',
      });
      return;
    }

    try {
      await deleteDoc(doc(db, 'inventory', itemId));
      setItems((prev) => {
        const newList = prev.filter((i) => i.id !== itemId);
        recalculateSummary(newList);
        try {
          localStorage.setItem('warehouse_inventory', JSON.stringify(newList));
        } catch (_) {}
        return newList;
      });
      if (selectedItem?.id === itemId) {
        setSelectedItem(null);
      }
      addToast({
        type: 'success',
        title: 'ลบสินค้าสำเร็จ',
        message: `ลบสินค้า ${itemId} เรียบร้อยแล้ว`,
      });
    } catch (err) {
      console.error('Error deleting item:', err);
      throw err;
    }
  };

  // Admin Requisition editing & deletion handlers
  const handleSaveEditedRequisition = async (updatedRecord: RequisitionRecord) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขประวัติได้',
      });
      return;
    }

    try {
      const cleanRecord = cleanForFirestore(updatedRecord);
      await setDoc(doc(db, 'requisitions', cleanRecord.id), cleanRecord);
      setRequisitions((prev) => prev.map((r) => (r.id === cleanRecord.id ? cleanRecord : r)));
      addToast({
        type: 'success',
        title: 'แก้ไขประวัติสำเร็จ',
        message: `บันทึกการแก้ไขรายการ ${cleanRecord.id} เรียบร้อยแล้ว`,
      });
    } catch (err) {
      console.error('Error updating requisition:', err);
      throw err;
    }
  };

  // Delete a requisition log record (ADMIN ONLY)
  const handleDeleteRequisition = async (id: string) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบประวัติการเบิกได้',
      });
      return;
    }

    try {
      const cleanId = id.replace(/^REQ-?(?:IN-?)?/i, '');
      const deletedSet = getDeletedRequisitionIds();
      deletedSet.add(cleanId);
      try {
        localStorage.setItem('warehouse_deleted_req_ids', JSON.stringify(Array.from(deletedSet)));
      } catch (_) {}

      await deleteDoc(doc(db, 'requisitions', id));
      setRequisitions((prev) => prev.filter((r) => r.id !== id && r.id !== cleanId));
      addToast({
        type: 'success',
        title: 'ลบประวัติสำเร็จ',
        message: `ลบประวัติรายการ ${id} เรียบร้อยแล้ว`,
      });
    } catch (err) {
      console.error("Failed to delete requisition", err);
      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถลบประวัติรายการได้ กรุณาลองใหม่อีกครั้ง',
      });
    }
  };

  // ==========================================
  // Purchase Order Handlers (ฟังก์ชันสั่งซื้อสินค้า)
  // ==========================================
  const handleOpenOrderModal = (item: InventoryItem) => {
    setOrderModalItem(item);
  };

  const handleSubmitOrder = async (orderData: Partial<PurchaseOrder>) => {
    try {
      setIsSubmittingOrder(true);
      const newOrder: PurchaseOrder = {
        id: orderData.id || `PO-${Date.now()}`,
        itemId: orderData.itemId || '',
        itemName: orderData.itemName || '',
        category: orderData.category || '',
        qty: Number(orderData.qty) || 1,
        unit: orderData.unit || 'ชิ้น',
        currentQty: orderData.currentQty,
        minStock: orderData.minStock,
        location: orderData.location,
        requestedBy: orderData.requestedBy || currentUser?.name || 'ช่างเทคนิค',
        brand: orderData.brand || '',
        model: orderData.model || '',
        supplier: orderData.supplier || '',
        note: orderData.note || '',
        urgency: orderData.urgency || 'normal',
        status: 'pending',
        createdAt: new Date().toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        isoDate: new Date().toISOString(),
        confirmationToken: Math.random().toString(36).substring(2, 10),
      };

      // 1. Save order to Firestore
      await setDoc(doc(db, 'orders', newOrder.id), cleanForFirestore(newOrder));

      // 2. Mark item as ordered in Firestore
      if (newOrder.itemId) {
        try {
          const itemRef = doc(db, 'inventory', newOrder.itemId);
          await setDoc(itemRef, {
            ordered: `สั่งซื้อแล้ว ${newOrder.qty} ${newOrder.unit}`,
            orderedDate: new Date().toISOString(),
          }, { merge: true });
        } catch (itemErr) {
          console.warn("Could not update item ordered date:", itemErr);
        }
      }

      // 3. Update local state for 0ms response
      setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);

      // 4. Send interactive notification to LINE (with One-Click Confirm button)
      try {
        await notifyPurchaseOrder(newOrder);
      } catch (lineErr) {
        console.warn("LINE notification error:", lineErr);
      }

      // 5. Sound & User Feedback
      playSuccessSoundAndSpeak(`บันทึกคำสั่งซื้อ ${newOrder.itemName} เรียบร้อยแล้ว`);
      addToast({
        type: 'success',
        title: 'สร้างคำสั่งซื้อสำเร็จ',
        message: `ส่งคำสั่งซื้อ ${newOrder.id} และแจ้งเตือนไปยัง LINE เรียบร้อยแล้ว`
      });

      setOrderModalItem(null);
      setIsCreateOrderModalOpen(false);
    } catch (err: any) {
      console.error("Submit order error:", err);
      addToast({
        type: 'error',
        title: 'สร้างคำสั่งซื้อไม่สำเร็จ',
        message: err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
      });
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleConfirmOrder = async (orderId: string) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถกดยืนยันคำสั่งซื้อได้',
      });
      return;
    }

    const targetOrder = orders.find(o => o.id === orderId);
    const confirmerName = currentUser?.name || 'ผู้ดูแลระบบ (Admin Web)';
    const nowIso = new Date().toISOString();
    const nowTimeStr = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      let committedOrder: PurchaseOrder | null = null;
      let committedItem: InventoryItem | null = null;
      let transactionCommitted = false;

      if (db) {
        const txResult = await runTransaction(db, async (transaction) => {
          // 1. READ PHASE: Read Order and related Inventory Item atomically
          const orderRef = doc(db, 'orders', orderId);
          const orderSnap = await transaction.get(orderRef);

          const orderData: PurchaseOrder | undefined = orderSnap.exists()
            ? (orderSnap.data() as PurchaseOrder)
            : targetOrder;

          if (!orderData) {
            throw new Error(`ไม่พบข้อมูลใบสั่งซื้อ ${orderId} ในระบบ`);
          }

          const isAlreadyProcessed =
            orderData.status !== 'pending' ||
            Boolean(orderData.confirmedAt) ||
            Boolean(orderData.confirmationTokenUsed);

          if (isAlreadyProcessed) {
            const conflictErr: any = new Error(
              `คำสั่งซื้อ ${orderId} (${orderData.itemName}) ได้รับการยืนยันไปแล้วเมื่อ ${orderData.confirmedAt || 'ก่อนหน้านี้'} โดย ${orderData.confirmedBy || 'ผู้ดูแลระบบ'}`
            );
            conflictErr.alreadyConfirmed = true;
            conflictErr.order = orderData;
            throw conflictErr;
          }

          const targetItemId = (orderData.itemId || '').trim();
          const localItem = items.find(
            i =>
              (targetItemId && i.id.trim().toLowerCase() === targetItemId.toLowerCase()) ||
              (orderData.itemName && i.name.trim().toLowerCase() === orderData.itemName.trim().toLowerCase())
          );
          const resolvedItemId = (localItem?.id || targetItemId).trim();
          const itemRef = resolvedItemId ? doc(db, 'inventory', resolvedItemId) : null;
          const itemSnap = itemRef ? await transaction.get(itemRef) : null;

          // 2. WRITE PHASE: Atomically update Order status and Inventory ordered status
          const nextOrder: PurchaseOrder = cleanForFirestore({
            ...orderData,
            id: orderData.id || orderId,
            status: 'confirmed',
            confirmedAt: nowTimeStr,
            confirmedBy: confirmerName,
            confirmedVia: 'admin_web',
            confirmationTokenUsed: true,
            isLocked: true,
            updatedAt: nowIso,
          });

          transaction.set(
            orderRef,
            { ...nextOrder, confirmationToken: null },
            { merge: true }
          );

          let nextItem: InventoryItem | null = null;
          const baseItem = itemSnap?.exists() ? (itemSnap.data() as InventoryItem) : localItem;
          if (itemRef && baseItem) {
            const currentQty = Number(baseItem.qty) || 0;
            const minStock = Number(baseItem.minStock) || 1;
            const currentStatus: 'normal' | 'low' | 'out' =
              currentQty <= 0 ? 'out' : currentQty <= minStock ? 'low' : 'normal';

            nextItem = cleanForFirestore({
              ...baseItem,
              id: baseItem.id || resolvedItemId,
              name: baseItem.name || orderData.itemName || 'สินค้า',
              category: baseItem.category || orderData.category || 'ทั่วไป',
              unit: baseItem.unit || orderData.unit || 'ชิ้น',
              qty: currentQty,
              minStock,
              location: baseItem.location || orderData.location || 'Store FL.6',
              note: baseItem.note || '',
              status: currentStatus,
              ordered: `สั่งซื้อแล้ว ${orderData.qty} ${orderData.unit} (${nowTimeStr})`,
              orderedDate: nowIso,
              outOfStockDate: currentQty > 0 ? '' : (baseItem.outOfStockDate || nowIso),
              lastUpdated: nowIso,
            });
            transaction.set(itemRef, nextItem, { merge: true });
          }

          return { updatedOrder: nextOrder, updatedItem: nextItem };
        });

        committedOrder = txResult.updatedOrder;
        committedItem = txResult.updatedItem;
        transactionCommitted = true;
      }

      // Sync state & localStorage immediately after atomic commit
      if (committedOrder) {
        const finalOrder = committedOrder;
        setOrders(prev => {
          const exists = prev.some(o => o.id === orderId);
          const updated = exists ? prev.map(o => (o.id === orderId ? finalOrder : o)) : [finalOrder, ...prev];
          try {
            localStorage.setItem('warehouse_orders', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });
      }

      if (committedItem) {
        const finalItem = committedItem;
        setItems(prev => {
          const updatedList = prev.map(i =>
            i.id.trim().toLowerCase() === finalItem.id.trim().toLowerCase() ? finalItem : i
          );
          try {
            localStorage.setItem('warehouse_inventory', JSON.stringify(updatedList));
          } catch (_) {}
          return updatedList;
        });

        if (selectedItem && selectedItem.id.trim().toLowerCase() === finalItem.id.trim().toLowerCase()) {
          setSelectedItem(finalItem);
        }
      }

      // Notify backend server for Cloud SQL persistence & LINE notification
      const res = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          confirmedBy: confirmerName,
          userRole: currentUser?.role || 'user',
          order: committedOrder || targetOrder,
          item: committedItem,
          transactionCommitted,
        }),
      });

      if (!transactionCommitted) {
        if (res.ok) {
          const data = await res.json();
          if (data.order) {
            setOrders(prev => {
              const updated = prev.map(o => (o.id === orderId ? data.order : o));
              try {
                localStorage.setItem('warehouse_orders', JSON.stringify(updated));
              } catch (_) {}
              return updated;
            });
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 409 || errData.alreadyConfirmed) {
            if (errData.order) {
              setOrders(prev => prev.map(o => (o.id === orderId ? errData.order : o)));
            }
            addToast({
              type: 'warning',
              title: 'คำสั่งซื้อนี้ยืนยันไปแล้ว',
              message: errData.error || `ใบสั่งซื้อ ${orderId} ได้รับการยืนยันไปแล้ว ไม่สามารถกดยืนยันซ้ำได้`,
            });
            return;
          }
          throw new Error(errData.error || 'ไม่สามารถยืนยันคำสั่งซื้อได้');
        }
      }

      addToast({
        type: 'success',
        title: 'ยืนยันการสั่งซื้อสำเร็จ',
        message: `ใบสั่งซื้อ ${orderId} ได้รับการยืนยันแบบ Atomic Transaction แล้ว`,
      });
    } catch (err: any) {
      if (err?.alreadyConfirmed) {
        if (err.order) {
          setOrders(prev => prev.map(o => (o.id === orderId ? err.order : o)));
        }
        addToast({
          type: 'warning',
          title: 'คำสั่งซื้อนี้ยืนยันไปแล้ว',
          message: err.message || `ใบสั่งซื้อ ${orderId} ได้รับการยืนยันไปแล้ว ไม่สามารถกดยืนยันซ้ำได้`,
        });
        return;
      }

      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err.message || 'ไม่สามารถยืนยันคำสั่งซื้อได้',
      });
    }
  };

  const handleReceiveOrder = async (orderId: string, receivedQty: number, note?: string) => {
    const targetOrder = orders.find(o => o.id === orderId);
    const receiverName = currentUser?.name || 'เจ้าหน้าที่คลังสินค้า';
    const nowIso = new Date().toISOString();
    const nowTimeStr = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const targetItemId = (targetOrder?.itemId || '').trim();
    const fallbackItem = items.find(
      i =>
        (targetItemId && i.id.trim().toLowerCase() === targetItemId.toLowerCase()) ||
        (targetOrder?.itemName && i.name.trim().toLowerCase() === targetOrder.itemName.trim().toLowerCase())
    );
    const candidateReqId = getNextRequisitionId(requisitions);

    try {
      let committedOrder: PurchaseOrder;
      let committedItem: InventoryItem;
      let committedRecord: RequisitionRecord;
      let previousQty = Number(fallbackItem?.qty) || 0;
      let newQty = previousQty;
      let qtyToAdd = Number(receivedQty) > 0 ? Number(receivedQty) : (Number(targetOrder?.qty) || 1);
      let transactionCommitted = false;

      if (db) {
        const txResult = await runTransaction(db, async (transaction) => {
          // 1. READ PHASE: Read Order, Inventory Item, and Requisition ID atomically
          const orderRef = doc(db, 'orders', orderId);
          const orderSnap = await transaction.get(orderRef);

          const orderData: PurchaseOrder | undefined = orderSnap.exists()
            ? (orderSnap.data() as PurchaseOrder)
            : targetOrder;

          if (!orderData) {
            throw new Error(`ไม่พบข้อมูลใบสั่งซื้อ ${orderId} ในระบบ`);
          }

          if (orderData.status === 'received') {
            const dupErr: any = new Error(
              `ใบสั่งซื้อ ${orderId} ถูกรับสินค้าเข้าคลังไปแล้วเมื่อ ${orderData.receivedAt || 'ก่อนหน้านี้'} โดย ${orderData.receivedBy || 'เจ้าหน้าที่'}`
            );
            dupErr.alreadyReceived = true;
            dupErr.order = orderData;
            throw dupErr;
          }

          if (orderData.status === 'cancelled') {
            throw new Error(`ใบสั่งซื้อ ${orderId} ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าเข้าคลังได้`);
          }

          const resolvedItemId = (
            orderData.itemId ||
            fallbackItem?.id ||
            `A${Date.now().toString().slice(-9)}`
          ).trim();

          const itemRef = doc(db, 'inventory', resolvedItemId);
          const itemSnap = await transaction.get(itemRef);

          const reqRef = doc(db, 'requisitions', candidateReqId);
          const reqSnap = await transaction.get(reqRef);

          // 2. WRITE PHASE: Compute authoritative state and write Order, Inventory, and Requisition atomically
          const baseItem: Partial<InventoryItem> = itemSnap.exists()
            ? (itemSnap.data() as InventoryItem)
            : (fallbackItem || {});

          const txPrevQty = Number(baseItem.qty) || 0;
          const txQtyToAdd = Number(receivedQty) > 0 ? Number(receivedQty) : (Number(orderData.qty) || 1);
          const txNewQty = txPrevQty + txQtyToAdd;
          const minStock = Number(baseItem.minStock) || Number(orderData.minStock) || 1;
          const newStatus: 'normal' | 'low' | 'out' =
            txNewQty <= 0 ? 'out' : txNewQty <= minStock ? 'low' : 'normal';

          const nextItem: InventoryItem = cleanForFirestore({
            ...baseItem,
            id: baseItem.id || resolvedItemId,
            name: baseItem.name || orderData.itemName || 'สินค้าสั่งซื้อ',
            category: baseItem.category || orderData.category || 'ทั่วไป',
            unit: baseItem.unit || orderData.unit || 'ชิ้น',
            qty: txNewQty,
            minStock,
            location: baseItem.location || orderData.location || 'Store FL.6',
            brand: baseItem.brand || orderData.brand || '',
            model: baseItem.model || orderData.model || '',
            note: baseItem.note || '',
            ordered: '',
            orderedDate: '',
            status: newStatus,
            outOfStockDate: txNewQty > 0 ? '' : (baseItem.outOfStockDate || nowIso),
            lastUpdated: nowIso,
          });

          const nextOrder: PurchaseOrder = cleanForFirestore({
            ...orderData,
            id: orderData.id || orderId,
            itemId: nextItem.id,
            itemName: nextItem.name,
            category: nextItem.category,
            qty: Number(orderData.qty) || txQtyToAdd,
            unit: nextItem.unit,
            requestedBy: orderData.requestedBy || receiverName,
            urgency: orderData.urgency || 'normal',
            createdAt: orderData.createdAt || nowTimeStr,
            isoDate: orderData.isoDate || nowIso,
            status: 'received',
            receivedAt: nowTimeStr,
            receivedBy: receiverName,
            receivedQty: txQtyToAdd,
            receiveNote: note || '',
            updatedAt: nowIso,
          });

          const finalReqId = reqSnap.exists()
            ? `${candidateReqId}-${Date.now().toString().slice(-3)}`
            : candidateReqId;
          const finalReqRef = reqSnap.exists() ? doc(db, 'requisitions', finalReqId) : reqRef;

          const nextRecord: RequisitionRecord = cleanForFirestore({
            id: finalReqId,
            type: 'in',
            itemId: nextItem.id,
            itemName: nextItem.name,
            category: nextItem.category,
            qty: txQtyToAdd,
            unit: nextItem.unit,
            requestedBy: receiverName,
            purpose: note
              ? `รับสินค้าตามใบสั่งซื้อ ${orderId} (${note})`
              : `รับสินค้าตามใบสั่งซื้อ ${orderId}`,
            timestamp: nowTimeStr,
            isoDate: nowIso,
            note: `รับเข้าจากใบสั่งซื้อ PO: ${orderId}`,
          });

          transaction.set(orderRef, nextOrder, { merge: true });
          transaction.set(itemRef, nextItem, { merge: true });
          transaction.set(finalReqRef, nextRecord);

          return {
            updatedOrder: nextOrder,
            updatedItem: nextItem,
            newRecord: nextRecord,
            previousQty: txPrevQty,
            newQty: txNewQty,
            qtyToAdd: txQtyToAdd,
          };
        });

        committedOrder = txResult.updatedOrder;
        committedItem = txResult.updatedItem;
        committedRecord = txResult.newRecord;
        previousQty = txResult.previousQty;
        newQty = txResult.newQty;
        qtyToAdd = txResult.qtyToAdd;
        transactionCommitted = true;
      } else {
        // Fallback when client Firestore is unavailable: delegate atomic transaction to backend API
        const res = await fetch('/api/orders/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            receivedQty: qtyToAdd,
            receivedBy: receiverName,
            userRole: currentUser?.role || 'user',
            note,
            order: targetOrder,
            currentItem: fallbackItem,
            requisitionId: candidateReqId,
            transactionCommitted: false,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'ไม่สามารถรับสินค้าเข้าคลังได้');
        }

        const data = await res.json();
        committedOrder = data.order;
        committedItem = data.item;
        committedRecord = data.requisition;
        newQty = Number(committedItem?.qty) || previousQty + qtyToAdd;
      }

      // 1. Update Orders, Inventory, and Requisition state & localStorage with committed transaction data
      setOrders(prev => {
        const exists = prev.some(o => o.id === orderId);
        const updated = exists ? prev.map(o => (o.id === orderId ? committedOrder : o)) : [committedOrder, ...prev];
        try {
          localStorage.setItem('warehouse_orders', JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });

      setItems(prev => {
        const exists = prev.some(i => i.id.trim().toLowerCase() === committedItem.id.trim().toLowerCase());
        const updatedList = exists
          ? prev.map(i => (i.id.trim().toLowerCase() === committedItem.id.trim().toLowerCase() ? committedItem : i))
          : [committedItem, ...prev];
        recalculateSummary(updatedList);
        try {
          localStorage.setItem('warehouse_inventory', JSON.stringify(updatedList));
        } catch (_) {}
        return updatedList;
      });

      if (selectedItem && selectedItem.id.trim().toLowerCase() === committedItem.id.trim().toLowerCase()) {
        setSelectedItem(committedItem);
      }

      setRequisitions(prev => {
        const updatedReqs = [committedRecord, ...prev.filter(r => r.id !== committedRecord.id)];
        try {
          localStorage.setItem('warehouse_requisitions', JSON.stringify(updatedReqs));
        } catch (_) {}
        return updatedReqs;
      });

      // 2. If transaction committed on client, notify backend server to sync Cloud SQL, server cache, and LINE notification
      if (transactionCommitted) {
        fetch('/api/orders/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            receivedQty: qtyToAdd,
            receivedBy: receiverName,
            userRole: currentUser?.role || 'user',
            note,
            order: committedOrder,
            currentItem: committedItem,
            requisitionRecord: committedRecord,
            expectedNewQty: newQty,
            requisitionId: committedRecord.id,
            transactionCommitted: true,
          }),
        }).catch(err => console.warn('Server order receive sync warning:', err));
      }

      // 3. Show Transaction Success Modal & Audio/Toast Feedback
      setTransactionSuccess({
        type: 'in',
        itemId: committedItem.id,
        itemName: committedItem.name,
        category: committedItem.category,
        qty: qtyToAdd,
        unit: committedItem.unit,
        requestedBy: receiverName,
        purpose: committedRecord.purpose,
        timestamp: nowTimeStr,
        previousQty,
        newQty,
      });

      playSuccessSoundAndSpeak(`รับสินค้า ${committedItem.name} จำนวน ${qtyToAdd} ${committedItem.unit} เข้าคลังเรียบร้อยแล้วค่ะ`);
      addToast({
        type: 'success',
        title: 'รับสินค้าเข้าคลังเรียบร้อย',
        message: `เพิ่มสต็อก ${committedItem.name} +${qtyToAdd} ${committedItem.unit} (คงเหลือ: ${newQty} ${committedItem.unit})`,
      });
    } catch (err: any) {
      if (err?.alreadyReceived) {
        if (err.order) {
          setOrders(prev => prev.map(o => (o.id === orderId ? err.order : o)));
        }
        addToast({
          type: 'warning',
          title: 'รายการนี้รับเข้าคลังไปแล้ว',
          message: err.message || `ใบสั่งซื้อ ${orderId} ถูกรับเข้าคลังไปแล้ว`,
        });
        return;
      }

      console.error('Receive order error:', err);
      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err.message || 'ไม่สามารถรับสินค้าเข้าคลังได้',
      });
      throw err;
    }
  };

  const handleCancelOrder = async (orderId: string, reason?: string) => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถยกเลิกใบสั่งซื้อได้',
      });
      return;
    }

    const targetOrder = orders.find(o => o.id === orderId);
    const cancellerName = currentUser?.name || 'ผู้ดูแลระบบ';
    const nowIso = new Date().toISOString();

    try {
      let committedOrder: PurchaseOrder | null = null;
      let committedItem: InventoryItem | null = null;

      if (db) {
        const txResult = await runTransaction(db, async (transaction) => {
          const orderRef = doc(db, 'orders', orderId);
          const orderSnap = await transaction.get(orderRef);
          const orderData: PurchaseOrder | undefined = orderSnap.exists()
            ? (orderSnap.data() as PurchaseOrder)
            : targetOrder;

          if (!orderData) {
            throw new Error(`ไม่พบข้อมูลใบสั่งซื้อ ${orderId}`);
          }

          if (orderData.status === 'received') {
            throw new Error(`ใบสั่งซื้อ ${orderId} รับสินค้าเข้าคลังแล้ว ไม่สามารถยกเลิกได้`);
          }

          const targetItemId = (orderData.itemId || '').trim();
          const itemRef = targetItemId ? doc(db, 'inventory', targetItemId) : null;
          const itemSnap = itemRef ? await transaction.get(itemRef) : null;

          const nextOrder: PurchaseOrder = cleanForFirestore({
            ...orderData,
            id: orderData.id || orderId,
            status: 'cancelled',
            cancelReason: reason || 'ยกเลิกโดยผู้ดูแลระบบ',
            cancelledBy: cancellerName,
            updatedAt: nowIso,
          });

          transaction.set(orderRef, nextOrder, { merge: true });

          let nextItem: InventoryItem | null = null;
          if (itemRef && itemSnap?.exists()) {
            const existingItem = itemSnap.data() as InventoryItem;
            nextItem = cleanForFirestore({
              ...existingItem,
              ordered: '',
              lastUpdated: nowIso,
            });
            transaction.set(itemRef, nextItem, { merge: true });
          }

          return { updatedOrder: nextOrder, updatedItem: nextItem };
        });

        committedOrder = txResult.updatedOrder;
        committedItem = txResult.updatedItem;
      }

      if (committedOrder) {
        const finalOrder = committedOrder;
        setOrders(prev => {
          const updated = prev.map(o => (o.id === orderId ? finalOrder : o));
          try {
            localStorage.setItem('warehouse_orders', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });
      }

      if (committedItem) {
        const finalItem = committedItem;
        setItems(prev => {
          const updatedList = prev.map(i =>
            i.id.trim().toLowerCase() === finalItem.id.trim().toLowerCase() ? finalItem : i
          );
          try {
            localStorage.setItem('warehouse_inventory', JSON.stringify(updatedList));
          } catch (_) {}
          return updatedList;
        });
      }

      await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          reason,
          cancelledBy: cancellerName,
          userRole: currentUser?.role || 'user',
          order: committedOrder || targetOrder,
        }),
      }).catch(err => console.warn('Server order cancel sync warning:', err));

      addToast({
        type: 'info',
        title: 'ยกเลิกคำสั่งซื้อแล้ว',
        message: `ยกเลิกใบสั่งซื้อ ${orderId} เรียบร้อย`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err.message || 'ไม่สามารถยกเลิกคำสั่งซื้อได้',
      });
    }
  };

  const handleResendLineNotification = async (order: PurchaseOrder) => {
    try {
      const res = await notifyPurchaseOrder(order);
      if (res.success) {
        addToast({
          type: 'success',
          title: 'ส่ง LINE สำเร็จ',
          message: `ส่งการแจ้งเตือนคำสั่งซื้อ ${order.id} ไปยัง LINE แล้ว`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'ส่ง LINE ไม่สำเร็จ',
          message: res.message || 'กรุณาตรวจสอบการตั้งค่า LINE Token',
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err.message,
      });
    }
  };

  // Handle database modifications executed by AI (0ms Optimistic Update)
  const handleExecuteDbAction = async (action: DbActionPayload) => {
    if (action.action === 'error') {
      addToast({ type: 'error', title: 'ไม่สามารถทำรายการได้', message: action.message || 'เกิดข้อผิดพลาด' });
      setDbErrorAlert(action.message || 'เกิดข้อผิดพลาดในการทำรายการ');
      return;
    }

    if ((action.action === 'update_stock' || (action.action as any) === 'edit_item') && currentUser?.role !== 'admin') {
      addToast({ type: 'error', title: 'ไม่มีสิทธิ์ดำเนินการ', message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขสต็อกหรือชื่ออะไหล่ได้' });
      return;
    }
    
    // Popup Success
    if (action.action === 'requisition') {
      addToast({ type: 'success', title: 'เบิกสินค้าสำเร็จ', message: `เบิก ${action.item?.name || 'สินค้า'} จำนวน ${action.record?.qty || 0}` });
    } else if (action.action === 'stock_in') {
      addToast({ type: 'success', title: 'รับเข้าสินค้าสำเร็จ', message: `รับเข้า ${action.item?.name || 'สินค้า'} จำนวน ${action.record?.qty || 0}` });
    } else if (action.action === 'update_stock') {
      addToast({ type: 'success', title: 'อัปเดตสต็อกสำเร็จ', message: `อัปเดต ${action.item?.name || 'สินค้า'} เรียบร้อย` });
    }

    if (action.action === 'requisition' || action.action === 'stock_in') {
      const isStockIn = action.action === 'stock_in';
      const itemName = action.item?.name || 'สินค้า';
      const qty = action.record?.qty || 0;
      const unit = action.item?.unit || 'ชิ้น';

      // Play chime and speak if not suppressed (e.g. when handled by Live Speech)
      if (!action.skipVoice) {
        playSuccessSoundAndSpeak(
          isStockIn
            ? `บันทึกรับเข้า ${itemName} จำนวน ${qty} ${unit} เรียบร้อยแล้วค่ะ`
            : `บันทึกการเบิก ${itemName} จำนวน ${qty} ${unit} เรียบร้อยแล้วค่ะ`
        );
      }

      if (action.item && action.record) {
        setTransactionSuccess({
          type: isStockIn ? 'in' : 'out',
          itemId: action.item.id,
          itemName: action.item.name,
          category: action.item.category,
          qty: action.record.qty,
          unit: action.item.unit,
          requestedBy: action.record.requestedBy,
          purpose: action.record.purpose,
          timestamp: action.record.timestamp,
          newQty: action.item.qty,
        });
      }

      if (action.record) {
        const cleanRecord = cleanForFirestore(action.record);
        setRequisitions((prev) => {
          const updated = [cleanRecord, ...prev];
          try {
            localStorage.setItem('warehouse_requisitions', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });
        setDoc(doc(db, 'requisitions', cleanRecord.id), cleanRecord).catch(err => console.error("Failed to save requisition", err));
      }
      if (action.item) {
        const oldItem = items.find(i => i.id === action.item?.id);
        const cleanItem = cleanForFirestore({
          ...action.item,
          ...(action.item.status === 'out' 
            ? { outOfStockDate: oldItem?.outOfStockDate || new Date().toISOString() } 
            : {})
        });

        // Instant optimistic update (0ms)
        setItems((prev) => {
          const updated = prev.map((i) => (i.id === cleanItem.id ? cleanItem : i));
          recalculateSummary(updated);
          try {
            localStorage.setItem('warehouse_inventory', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });

        if (selectedItem?.id === cleanItem.id) {
          setSelectedItem(cleanItem);
        }

        setDoc(doc(db, 'inventory', cleanItem.id), cleanItem).catch(err => console.error("Failed to update inventory", err));

        // Send LINE notification for AI-assisted stock actions
        if (action.record) {
          notifyStockTransaction({
            type: isStockIn ? 'in' : 'out',
            itemId: cleanItem.id,
            itemName: cleanItem.name,
            category: cleanItem.category,
            qty: action.record.qty,
            unit: cleanItem.unit,
            location: cleanItem.location,
            requestedBy: action.record.requestedBy,
            purpose: action.record.purpose,
            previousQty: oldItem?.qty,
            newQty: cleanItem.qty,
            status: cleanItem.status,
            timestamp: action.record.timestamp,
          }).catch(err => console.warn("LINE notification error from AI action:", err));

          // Web Push notification for AI-assisted stock actions
          if (action.record.type === 'out') {
            triggerImportantRequisitionPush({
              itemId: cleanItem.id,
              itemName: cleanItem.name,
              qty: action.record.qty,
              unit: cleanItem.unit,
              requestedBy: action.record.requestedBy,
              purpose: action.record.purpose,
              newQty: cleanItem.qty,
            }).catch(err => console.warn("Web Push AI requisition notice:", err));
          }
          if (cleanItem.qty <= (cleanItem.minStock || 5) || cleanItem.status === 'low' || cleanItem.status === 'out') {
            triggerLowStockPush(cleanItem, cleanItem.qty).catch(err => console.warn("Web Push AI low stock notice:", err));
          }
        }
      }
    } else if (action.action === 'update_stock') {
      if (action.item) {
        const oldItem = items.find(i => i.id === action.item?.id);
        const cleanItem = cleanForFirestore({
          ...action.item,
          ...(action.item.status === 'out' 
            ? { outOfStockDate: oldItem?.outOfStockDate || new Date().toISOString() } 
            : {})
        });

        // Trigger low stock push if direct update makes item low or out
        if (cleanItem.qty <= (cleanItem.minStock || 5) || cleanItem.status === 'low' || cleanItem.status === 'out') {
          triggerLowStockPush(cleanItem, cleanItem.qty).catch(err => console.warn("Web Push stock update notice:", err));
        }

        // Instant optimistic update (0ms)
        setItems((prev) => {
          const updated = prev.map((i) => (i.id === cleanItem.id ? cleanItem : i));
          recalculateSummary(updated);
          try {
            localStorage.setItem('warehouse_inventory', JSON.stringify(updated));
          } catch (_) {}
          return updated;
        });

        if (selectedItem?.id === cleanItem.id) {
          setSelectedItem(cleanItem);
        }

        setDoc(doc(db, 'inventory', cleanItem.id), cleanItem).catch(err => console.error("Failed to update inventory", err));
      }
    } else if (action.action === 'delete_record' && action.recordId) {
      setRequisitions((prev) => {
        const updated = prev.filter((r) => r.id !== action.recordId);
        try {
          localStorage.setItem('warehouse_requisitions', JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });
      deleteDoc(doc(db, 'requisitions', action.recordId)).catch(err => console.error("Failed to delete requisition", err));
    }

    // Popup Warning for low stock after requisition
    if (action.action === 'requisition' && action.item) {
      const it = action.item;
      if (it.qty <= 0) {
        addToast({ 
          type: 'error', 
          title: '⚠️ สินค้าหมดสต็อก!', 
          message: `${it.name} หมดสต็อกแล้ว (คงเหลือ 0 ${it.unit})`,
          actionText: 'ดูสินค้า',
          onClick: () => {
            setSelectedItem(it);
            setActiveTab('inventory');
          }
        });
      } else if (it.qty <= it.minStock) {
        addToast({ 
          type: 'warning', 
          title: '⚠️ สินค้าใกล้หมด', 
          message: `${it.name} เหลือเพียง ${it.qty} ${it.unit}`,
          actionText: 'ดูสินค้า',
          onClick: () => {
            setSelectedItem(it);
            setActiveTab('inventory');
          }
        });
      }
    }
  };

  // Filter Items with deferredSearchQuery for silky smooth typing + Favorite Items pinned at top
  const filteredItems = useMemo(() => {
    const queryStr = deferredSearchQuery.trim().toLowerCase();
    const matched = items.filter((item) => {
      const matchesSearch =
        queryStr === '' ||
        item.name.toLowerCase().includes(queryStr) ||
        item.id.toLowerCase().includes(queryStr) ||
        item.category.toLowerCase().includes(queryStr) ||
        item.location.toLowerCase().includes(queryStr);

      const matchesCategory =
        selectedCategory === 'ทั้งหมด' ||
        (selectedCategory === '★ รายการโปรด' ? favoriteItemIds.has(item.id) : item.category === selectedCategory);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'favorites' && favoriteItemIds.has(item.id)) ||
        (statusFilter === 'low' && item.status === 'low') ||
        (statusFilter === 'out' && item.status === 'out') ||
        (statusFilter === 'low_or_out' && (item.status === 'low' || item.status === 'out' || Number(item.qty) <= Number(item.minStock)));

      return matchesSearch && matchesCategory && matchesStatus;
    });

    // Pin favorite items to the top!
    return matched.sort((a, b) => {
      const aFav = favoriteItemIds.has(a.id) ? 1 : 0;
      const bFav = favoriteItemIds.has(b.id) ? 1 : 0;
      if (aFav !== bFav) {
        return bFav - aFav; // Favorites come first
      }
      return 0; // Preserve default order
    });
  }, [items, deferredSearchQuery, selectedCategory, statusFilter, favoriteItemIds]);

  // Memoized handlers for ItemCard to avoid unnecessary re-renders
  const handleCardClick = useCallback((item: InventoryItem) => {
    setSelectedItem(item);
  }, []);

  // Toggle Favorite Item (Pin / Unpin to top)
  const handleToggleFavorite = useCallback((item: InventoryItem) => {
    setFavoriteItemIds((prev) => {
      const next = new Set(prev);
      const isAdding = !next.has(item.id);
      if (isAdding) {
        next.add(item.id);
        addToast({
          type: 'success',
          title: '⭐ ปักหมุดรายการโปรดแล้ว',
          message: `ปักหมุด "${item.name}" ไว้ด้านบนสุดของรายการแล้ว`,
        });
      } else {
        next.delete(item.id);
        addToast({
          type: 'info',
          title: 'ยกเลิกการปักหมุด',
          message: `นำ "${item.name}" ออกจากรายการโปรดแล้ว`,
        });
      }

      const favArray = Array.from(next);
      const userKey = currentUser?.id || currentUser?.username 
        ? `warehouse_favorites_${currentUser.id || currentUser.username}` 
        : 'warehouse_favorites_default';
      try {
        localStorage.setItem(userKey, JSON.stringify(favArray));
        localStorage.setItem('warehouse_favorites', JSON.stringify(favArray));
      } catch (e) {
        console.warn('Failed to save favorites to localStorage:', e);
      }

      if (currentUser?.id) {
        updateDoc(doc(db, 'users', currentUser.id), { favorites: favArray }).catch(err => {
          console.warn('Failed to sync favorites to Firestore:', err);
        });
      }

      return next;
    });
  }, [currentUser, addToast]);

  const handleToggleSelectItem = useCallback((item: InventoryItem) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      filteredItems.forEach((item) => next.add(item.id));
      return next;
    });
  }, [filteredItems]);

  const handleClearSelection = useCallback(() => {
    setSelectedItemIds(new Set());
  }, []);

  const handleToggleMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode((prev) => {
      if (prev) {
        setSelectedItemIds(new Set());
      }
      return !prev;
    });
  }, []);

  // Handle Long Press on an ItemCard to trigger multi-select mode and select the item
  const handleItemLongPress = useCallback((item: InventoryItem) => {
    setIsMultiSelectMode(true);
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(40);
      } catch (_) {}
    }

    addToast({
      type: 'info',
      title: 'เข้าสู่โหมดเลือกหลายรายการ',
      message: `เลือก "${item.name}" แล้ว สามารถแตะรายการอื่นเพื่อเลือกเพิ่มได้`,
    });
  }, [addToast]);

  // Set of Item IDs with active inventory movements or updates within the last 24 hours
  const recentlyUpdatedItemIds = useMemo(() => {
    const activeSet = new Set<string>();
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // 1. Check item.lastUpdated
    items.forEach((item) => {
      if (item.lastUpdated) {
        const time = new Date(item.lastUpdated).getTime();
        if (!isNaN(time) && now - time <= TWENTY_FOUR_HOURS) {
          activeSet.add(item.id);
        }
      }
    });

    // 2. Check requisitions (stock-in or stock-out transactions) in the last 24 hours
    requisitions.forEach((r) => {
      if (!r.itemId) return;
      let recordTime: number | null = null;
      if (r.isoDate) {
        const d = new Date(r.isoDate).getTime();
        if (!isNaN(d)) recordTime = d;
      }
      if (!recordTime && r.timestamp) {
        const parsed = parseRecordDateTime(r.isoDate, r.timestamp);
        if (parsed) recordTime = parsed.getTime();
      }
      if (recordTime && now - recordTime <= TWENTY_FOUR_HOURS) {
        activeSet.add(r.itemId);
      }
    });

    return activeSet;
  }, [items, requisitions]);

  const handleStartMultiSelect = useCallback(async (preselectedItem?: InventoryItem | null) => {
    const isAllowed = await verifyLocation();
    if (!isAllowed) return;

    setIsRequisitionMenuOpen(false);
    setIsRequisitionModalOpen(false);
    setActiveTab('inventory');
    setIsMultiSelectMode(true);
    if (preselectedItem) {
      setSelectedItemIds(new Set([preselectedItem.id]));
    }
    addToast({
      type: 'info',
      title: 'เข้าสู่โหมดเลือกหลายชิ้น',
      message: 'ติ๊กเลือกรายการสินค้าที่ต้องการเบิก แล้วกดปุ่ม "เบิกพร้อมกัน"',
    });
  }, [verifyLocation, addToast]);

  const selectedItemsForBulk = useMemo(() => {
    return items.filter((item) => selectedItemIds.has(item.id));
  }, [items, selectedItemIds]);

  const handleOpenBulkModal = async () => {
    if (selectedItemIds.size === 0) {
      addToast({
        type: 'warning',
        title: 'ยังไม่ได้เลือกรายการ',
        message: 'กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการเพื่อทำการเบิก',
      });
      return;
    }
    const isAllowed = await verifyLocation();
    if (isAllowed) {
      setIsBulkRequisitionModalOpen(true);
    }
  };

  const handleBulkRequisitionSubmit = async (data: BulkRequisitionSubmitData) => {
    const isAllowed = await verifyLocation();
    if (!isAllowed) return;

    const now = new Date();
    const timestampStr = `${now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
    const isoDateStr = data.dateStr && data.timeStr 
      ? new Date(`${data.dateStr}T${data.timeStr}:00`).toISOString() 
      : now.toISOString();

    const newRecords: RequisitionRecord[] = [];
    const updatedItemsMap = new Map<string, InventoryItem>();
    const bulkItemsForSuccess: Array<{
      id: string;
      name: string;
      category?: string;
      qty: number;
      unit: string;
      newQty?: number;
    }> = [];

    data.items.forEach(({ item, qty }, idx) => {
      const recId = getNextRequisitionId(requisitions, idx);
      const newRecord: RequisitionRecord = cleanForFirestore({
        id: recId,
        type: 'out',
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        qty,
        unit: item.unit,
        requestedBy: data.requestedBy,
        purpose: data.purpose,
        timestamp: timestampStr,
        isoDate: isoDateStr,
        note: data.note,
      });
      newRecords.push(newRecord);

      const currentQty = Number(item.qty);
      const newQty = Math.max(0, currentQty - Number(qty));
      let newStatus: 'normal' | 'low' | 'out' = 'normal';
      if (newQty <= 0) newStatus = 'out';
      else if (newQty <= (item.minStock || 0)) newStatus = 'low';

      const updatedItem: InventoryItem = cleanForFirestore({
        ...item,
        qty: newQty,
        status: newStatus,
        lastUpdated: now.toISOString(),
        ...(newStatus === 'out' ? { outOfStockDate: item.outOfStockDate || now.toISOString() } : {})
      });
      updatedItemsMap.set(item.id, updatedItem);

      bulkItemsForSuccess.push({
        id: item.id,
        name: item.name,
        category: item.category,
        qty,
        unit: item.unit,
        newQty,
      });
    });

    // Instant local state update (0ms UI feedback)
    setRequisitions((prev) => {
      const updated = [...newRecords, ...prev];
      try {
        localStorage.setItem('warehouse_requisitions', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    setItems((prevItems) => {
      const nextItems = prevItems.map((item) => updatedItemsMap.get(item.id) || item);
      recalculateSummary(nextItems);
      try {
        localStorage.setItem('warehouse_inventory', JSON.stringify(nextItems));
      } catch (_) {}
      return nextItems;
    });

    // Reset selection & close modal
    setSelectedItemIds(new Set());
    setIsMultiSelectMode(false);
    setIsBulkRequisitionModalOpen(false);

    // Show success modal with audio/voice
    setTransactionSuccess({
      type: 'out',
      requestedBy: data.requestedBy,
      purpose: data.purpose,
      timestamp: timestampStr,
      isBulk: true,
      bulkItems: bulkItemsForSuccess,
    });

    addToast({
      type: 'success',
      title: 'เบิกสินค้าพร้อมกันสำเร็จ',
      message: `เบิกสำเร็จ ${bulkItemsForSuccess.length} รายการ (${bulkItemsForSuccess.reduce((sum, i) => sum + i.qty, 0)} ชิ้น)`,
    });

    // Persist to Firestore asynchronously
    const firestorePromises: Promise<any>[] = [];
    try {
      const batch = writeBatch(db);
      newRecords.forEach((rec) => {
        batch.set(doc(db, 'requisitions', rec.id), rec);
      });
      updatedItemsMap.forEach((uItem) => {
        batch.set(doc(db, 'inventory', uItem.id), uItem);
      });
      firestorePromises.push(batch.commit());
    } catch (err) {
      console.warn("Batch write fallback:", err);
      newRecords.forEach((rec) => firestorePromises.push(setDoc(doc(db, 'requisitions', rec.id), rec)));
      updatedItemsMap.forEach((uItem) => firestorePromises.push(setDoc(doc(db, 'inventory', uItem.id), uItem)));
    }
    Promise.all(firestorePromises).catch((err) => console.error("Firestore sync error:", err));

    // Send LINE Notification asynchronously
    notifyBulkStockTransaction({
      items: bulkItemsForSuccess.map(i => ({
        itemId: i.id,
        itemName: i.name,
        qty: i.qty,
        unit: i.unit,
        newQty: i.newQty,
      })),
      requestedBy: data.requestedBy,
      purpose: data.purpose,
      note: data.note,
      timestamp: timestampStr,
    }).catch((err) => console.warn("LINE bulk notification notice:", err));

    // Web Push alerts for low stock items
    updatedItemsMap.forEach((uItem) => {
      if (uItem.status === 'low' || uItem.status === 'out') {
        triggerLowStockPush(uItem, uItem.qty).catch((err) => console.warn("Web push alert:", err));
      }
    });
  };

  // Handle Admin Batch Update (Update Location and/or MinStock for multiple items simultaneously)
  const handleApplyBatchUpdate = async (payload: BatchUpdatePayload) => {
    const itemsToUpdate = items.filter(i => selectedItemIds.has(i.id));
    if (itemsToUpdate.length === 0) {
      addToast({
        type: 'warning',
        title: 'ไม่มีรายการที่เลือก',
        message: 'กรุณาเลือกรายการสินค้าที่ต้องการแก้ไข',
      });
      return;
    }

    const updatedMap = new Map<string, InventoryItem>();
    const batch = writeBatch(db);

    for (const item of itemsToUpdate) {
      let targetLocation = item.location || 'Store FL.6';
      if (payload.updateLocation) {
        targetLocation = payload.newLocation.trim() || 'Store FL.6';
      }

      let targetMinStock = item.minStock ?? 5;
      if (payload.updateMinStock) {
        if (payload.minStockMode === 'uniform') {
          targetMinStock = Math.max(0, payload.minStockValue);
        } else {
          targetMinStock = Math.max(0, (item.minStock ?? 5) + payload.minStockValue);
        }
      }

      let status: 'normal' | 'low' | 'out' = 'normal';
      if (item.qty <= 0) {
        status = 'out';
      } else if (item.qty <= targetMinStock) {
        status = 'low';
      }

      const updatedItem: InventoryItem = {
        ...item,
        location: targetLocation,
        minStock: targetMinStock,
        status,
        lastUpdated: new Date().toISOString(),
      };

      updatedMap.set(item.id, updatedItem);

      try {
        const itemRef = doc(db, 'inventory', item.id);
        batch.update(itemRef, {
          location: targetLocation,
          minStock: targetMinStock,
          status,
          lastModified: new Date().toISOString()
        });
      } catch (e) {
        console.warn('Batch update doc error:', e);
      }
    }

    // Instant optimistic local state update
    setItems((prevItems) => {
      const nextItems = prevItems.map(item => updatedMap.get(item.id) || item);
      recalculateSummary(nextItems);
      try {
        localStorage.setItem('warehouse_inventory', JSON.stringify(nextItems));
      } catch (_) {}
      return nextItems;
    });

    // Close modal and clear selection
    setIsBatchUpdateModalOpen(false);
    setSelectedItemIds(new Set());
    setIsMultiSelectMode(false);

    // Commit Firestore batch asynchronously
    batch.commit().catch(err => console.warn('Firestore batch update commit:', err));

    playSuccessSoundAndSpeak(`อัปเดตข้อมูลสินค้า ${itemsToUpdate.length} รายการเรียบร้อยแล้ว`);
    addToast({
      type: 'success',
      title: 'แก้ไขสินค้าแบบกลุ่มสำเร็จ',
      message: `อัปเดต ${itemsToUpdate.length} รายการเรียบร้อยแล้ว`,
    });
  };

  // Unique categories list
  const categoryList = summary?.categories.map((c) => c.name) || [
    'เคมี', 'ท่อ', 'ไฟฟ้า', 'Lighting', 'แอร์', 'สุขภัณฑ์', 'สี+Grouting', 'Fire Alarm', 'ประตู', 'เน็ต+โทรศัพท์'
  ];

  const handleExportInventoryPdf = async () => {
    if (currentUser?.role !== 'admin') {
      addToast({
        type: 'error',
        title: 'จำกัดสิทธิ์เฉพาะ Admin',
        message: 'การสร้างและดาวน์โหลดรายงาน PDF สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น'
      });
      return;
    }
    try {
      setIsExportingInventoryPdf(true);
      await generateAndDownloadPdf({
        type: 'inventory_all',
        title: 'รายงานสต็อกสินค้าคงคลังทั้งหมด (Store FL.6)',
        items: filteredItems.length > 0 ? filteredItems : items,
        requisitions,
        generatedBy: currentUser.name || currentUser.username || 'Admin',
      });
    } catch (err) {
      console.error('Error generating PDF:', err);
      addToast({
        type: 'error',
        title: 'สร้างไฟล์ PDF ไม่สำเร็จ',
        message: 'เกิดข้อผิดพลาดในการสร้างไฟล์รายงาน PDF กรุณาลองใหม่อีกครั้ง',
      });
    } finally {
      setIsExportingInventoryPdf(false);
    }
  };

  // Handle update Geo Location Geofencing system (Admin master setting for all users)
  const handleUpdateGeoConfig = async (newConfig: Partial<GeoConfig>) => {
    const updated = await saveGeoConfig(
      newConfig, 
      currentUser?.name || currentUser?.username || 'Admin',
      currentUser?.role || 'user'
    );
    setGeoConfig(updated);
    addToast({
      title: 'บันทึกการตั้งค่าพิกัดกลางแล้ว',
      message: updated.isGeoLocationEnabled
        ? `จำกัดพื้นที่ ${updated.locationName} (รัศมี ${updated.maxDistanceMeters} ม.) สำหรับผู้ใช้งานทุกคน`
        : 'ปิดระบบตรวจสอบพิกัด (ผู้ใช้งานทุกคนสามารถเบิก-รับได้ทุกสถานที่)',
      type: 'success'
    });
  };

  const handleToggleGeoLocation = async (enabled: boolean) => {
    await handleUpdateGeoConfig({ isGeoLocationEnabled: enabled });
  };

  // Ask AI about specific item or query
  const handleAskAIAboutItem = (item: InventoryItem) => {
    const prompt = `ขอทราบข้อมูลและสถานะของสินค้า ${item.name} (รหัส: ${item.id}) ที่เก็บ: ${item.location} หน่อย`;
    setPendingQuery(prompt);
    setActiveTab('voice');
  };

  const handleAskAIQuery = (prompt: string) => {
    setPendingQuery(prompt);
    setActiveTab('voice');
  };

  // Handle logout with device session cleanup
  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    const loggedOutUser = currentUser;
    try {
      if (currentUser?.id) {
        await updateDoc(doc(db, 'users', currentUser.id), {
          sessionToken: '',
          activeDeviceId: ''
        });
      }
    } catch (err) {
      console.warn('Logout session clear error:', err);
    } finally {
      if (loggedOutUser) {
        notifyAuthEvent({
          type: 'logout',
          userId: loggedOutUser.id,
          username: loggedOutUser.username,
          name: loggedOutUser.name,
          nickname: loggedOutUser.nickname,
          role: loggedOutUser.role,
        }).catch(err => console.warn("LINE logout notification notice:", err));
      }

      localStorage.removeItem('warehouse_user');
      setChatHistory([]);
      setCurrentUser(null);
      setShowLogoutConfirm(false);
      setIsLoggingOut(false);
    }
  };

  if (!currentUser) {
    const handleLogin = (user: User) => {
      setChatHistory([]);
      setCurrentUser(user);
      // Send real-time LINE login notification
      notifyAuthEvent({
        type: 'login',
        userId: user.id,
        username: user.username,
        name: user.name,
        nickname: user.nickname,
        role: user.role,
      }).catch(err => console.warn("LINE login notification notice:", err));
    };
    return <LoginView onLogin={handleLogin} />;
  }

  const normalStockCount = Math.max(
    0,
    items.length - (summary?.lowStockCount || 0) - (summary?.outOfStockCount || 0)
  );

  return (
    <div className="eng-canvas min-h-screen min-h-[100dvh] flex justify-center pl-safe pr-safe selection:bg-blue-600 selection:text-white relative overflow-x-hidden w-full max-w-full">
      {/* Global sleek loading progress bar */}
      <GlobalProgressBar isLoading={refreshing || loading} triggerKey={activeTab} />

      {/* Industrial Command Pro Responsive Shell */}
      <div 
        className={`eng-shell w-full max-w-full min-w-0 lg:max-w-7xl xl:max-w-[1440px] 2xl:max-w-[1600px] flex flex-col relative font-sans md:border-x md:border-slate-200/70 md:dark:border-white/10 md:shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)] overflow-x-hidden ${
          activeTab === 'voice' 
            ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' 
            : 'min-h-screen min-h-[100dvh]'
        }`}
      >
        {/* Top Industrial Command Header */}
        <header className="eng-header sticky top-0 z-30 px-3 sm:px-5 md:px-6 pt-safe-header pb-2.5">
          <div className="max-w-7xl mx-auto w-full">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Brand Logo & User Identity (Left) */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-950 shrink-0 shadow-md ring-2 ring-orange-400/70 ring-offset-2 ring-offset-white dark:ring-offset-[#0c1220]">
                  <EngLogo className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] sm:text-sm font-black tracking-tight text-slate-950 dark:text-white leading-none">
                      <span className="sm:hidden">ENG</span>
                      <span className="hidden sm:inline">ENG Smart Store</span>
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${
                        currentUser.role === 'admin'
                          ? 'bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800/70'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {currentUser.role === 'admin' ? 'ADMIN' : 'STAFF'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 min-w-0 mt-0.5" title={currentUser.name}>
                    <UserIcon className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[115px] sm:max-w-[180px]">
                      {currentUser.name || currentUser.username}
                    </span>
                  </div>
                </div>
              </div>

              {/* Segmented Command Tabs on Desktop (xl) */}
              <TopNavTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                requisitionCount={requisitions.length}
                lowStockCount={summary?.lowStockCount || 0}
                pendingOrdersCount={pendingOrdersCount}
                isAdmin={currentUser.role === 'admin'}
                isLiveActive={isLiveActive}
                className="hidden xl:flex"
              />

              {/* Header Command Actions (Right) */}
              <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:ml-auto sm:w-auto sm:gap-1.5">
                {/* Light/Dark Theme Switcher */}
                <ThemeToggle />

                {/* PWA In-App Install Prompt */}
                <PWAInstallButton />

                {/* Refresh / Sync Button */}
                <button
                  onClick={() => fetchInventory(true)}
                  disabled={refreshing}
                  className="eng-icon-btn"
                  title="ซิงค์ข้อมูลล่าสุด"
                  aria-label="ซิงค์ข้อมูลล่าสุด"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
                </button>

                {/* Notification Settings (Web Push & LINE Bot for Admin only) */}
                {currentUser.role === 'admin' && (
                  <button
                    onClick={() => {
                      setLineSettingsInitialTab('line');
                      setIsLineSettingsModalOpen(true);
                    }}
                    className="eng-icon-btn !text-blue-600 dark:!text-blue-400 !bg-blue-50 dark:!bg-blue-950/50 !border-blue-200 dark:!border-blue-800/70"
                    title="การแจ้งเตือน (Web Push & LINE)"
                    aria-label="การแจ้งเตือน"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}

                {/* Add Item (Admin) */}
                {currentUser.role === 'admin' && (
                  <button
                    onClick={handleOpenAddItemModal}
                    className="h-10 px-2.5 sm:px-3 rounded-xl bg-slate-950 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 dark:text-slate-950 text-white active:scale-[0.98] transition-colors text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm"
                    title="เพิ่มสินค้าใหม่ (Admin)"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">เพิ่มอะไหล่</span>
                  </button>
                )}

                {/* Requisition Split Button (เบิกของ) */}
                <div className="relative flex items-center rounded-lg" ref={requisitionMenuRef}>
                  <button
                    onClick={() => {
                      setIsRequisitionMenuOpen(false);
                      handleOpenRequisitionModal();
                    }}
                    className="h-10 px-3 sm:px-3.5 rounded-l-xl bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white active:scale-[0.98] transition-all text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-600/25 cursor-pointer"
                    title="บันทึกการเบิกของ / รับเข้าสต๊อก"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    <span>เบิกของ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsRequisitionMenuOpen((prev) => !prev)}
                    className="h-10 px-2 rounded-r-xl bg-blue-700 hover:bg-blue-800 text-white active:scale-[0.98] transition-colors border-l border-l-white/25 cursor-pointer flex items-center justify-center"
                    title="ตัวเลือกโหมดเบิกของ (เบิก 1 ชิ้น หรือ เลือกหลายชิ้น)"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isRequisitionMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Options for Requisition Mode */}
                  <AnimatePresence>
                    {isRequisitionMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15 }}
                        style={{ transformOrigin: 'top right' }}
                        className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-white dark:bg-[#101826] shadow-2xl border border-slate-200/80 dark:border-white/10 p-1.5 z-50 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setIsRequisitionMenuOpen(false);
                            handleOpenRequisitionModal();
                          }}
                          className="group w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/70 flex items-center justify-center shrink-0">
                            <ClipboardList className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">เบิก/รับทั่วไป (1 รายการ)</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">เปิดหน้าต่างบันทึกการเบิกหรือรับเข้า</div>
                          </div>
                        </button>

                        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                        <button
                          type="button"
                          onClick={() => {
                            setIsRequisitionMenuOpen(false);
                            handleStartMultiSelect();
                          }}
                          className="group w-full px-3 py-2 text-left text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                            <CheckSquare className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-bold text-blue-600 dark:text-blue-400">เลือกหลายชิ้น (เบิกเป็นชุด)</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">ติ๊กเลือกหลายรายการเพื่อตัดยอดพร้อมกัน</div>
                          </div>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Logout Button */}
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="eng-icon-btn hover:!text-red-600 dark:hover:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-950/40 hover:!border-red-200"
                  title="ออกจากระบบ"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {/* TAB 1: Inventory List */}
          {activeTab === 'inventory' && (
            <motion.div
              key="inventory"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col pb-28 sm:pb-32 w-full min-w-0 overflow-x-hidden"
            >
              {/* Industrial Command Pro Search, Bento KPI Strip & Filter Bar */}
              <div className="px-3 sm:px-5 md:px-6 py-3.5 w-full min-w-0">
                <div className="max-w-7xl mx-auto w-full min-w-0 space-y-2.5">
                  {/* Bento KPI Command Strip (Click to filter directly) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setStatusFilter('all')}
                      className={`kpi-tile ${statusFilter === 'all' ? 'kpi-tile-active' : ''}`}
                      style={{ '--kpi': '#2563eb' } as React.CSSProperties}
                    >
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">รายการอะไหล่ทั้งหมด</div>
                        <div className="font-mono font-black text-xl sm:text-2xl text-slate-950 dark:text-white tabular-nums leading-none mt-1">
                          {items.length.toLocaleString()}
                        </div>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatusFilter('all')}
                      className="kpi-tile"
                      style={{ '--kpi': '#059669' } as React.CSSProperties}
                    >
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">พร้อมเบิกใช้งาน</div>
                        <div className="font-mono font-black text-xl sm:text-2xl text-emerald-600 dark:text-emerald-400 tabular-nums leading-none mt-1">
                          {normalStockCount.toLocaleString()}
                        </div>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatusFilter(statusFilter === 'low' ? 'all' : 'low')}
                      className={`kpi-tile ${statusFilter === 'low' ? 'kpi-tile-active' : ''}`}
                      style={{ '--kpi': '#d97706' } as React.CSSProperties}
                    >
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">สต๊อกใกล้หมด</div>
                        <div className="font-mono font-black text-xl sm:text-2xl text-amber-600 dark:text-amber-400 tabular-nums leading-none mt-1">
                          {(summary?.lowStockCount || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatusFilter(statusFilter === 'out' ? 'all' : 'out')}
                      className={`kpi-tile ${statusFilter === 'out' ? 'kpi-tile-active' : ''}`}
                      style={{ '--kpi': '#dc2626' } as React.CSSProperties}
                    >
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">สินค้าหมดสต๊อก</div>
                        <div className="font-mono font-black text-xl sm:text-2xl text-red-600 dark:text-red-400 tabular-nums leading-none mt-1">
                          {(summary?.outOfStockCount || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                        <XCircle className="w-4 h-4" />
                      </div>
                    </button>
                  </div>

                  {/* Search Input & Quick Status Toolbar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ค้นหาชื่ออะไหล่, รหัสสินค้า (#A000...), หมวดหมู่, สถานที่จัดเก็บ..."
                        className="eng-search pl-10 pr-10 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Quick Filter & Admin Batch Actions */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                      <button
                        type="button"
                        onClick={() => setStatusFilter(statusFilter === 'favorites' ? 'all' : 'favorites')}
                        className={`h-11 px-3.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 border transition-colors cursor-pointer ${
                          statusFilter === 'favorites'
                            ? 'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/30'
                            : 'bg-white dark:bg-[#101826] text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-white/10 hover:border-amber-400'
                        }`}
                        title="แสดงเฉพาะรายการสินค้าที่ปักหมุดไว้"
                      >
                        <Star className={`w-3.5 h-3.5 ${statusFilter === 'favorites' ? 'fill-white text-white' : 'fill-amber-400 text-amber-500'}`} />
                        <span>ปักหมุด ({favoriteItemIds.size})</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleToggleMultiSelectMode}
                        className={`h-11 px-3.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 border transition-colors cursor-pointer ${
                          isMultiSelectMode
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30'
                            : 'bg-white dark:bg-[#101826] text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-white/10 hover:border-blue-400'
                        }`}
                        title="เลือกเบิกหลายรายการพร้อมกัน"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>เลือกหลายชิ้น</span>
                      </button>

                      {currentUser?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!isMultiSelectMode) {
                              setIsMultiSelectMode(true);
                            }
                            setIsBatchUpdateModalOpen(true);
                          }}
                          className="h-11 px-3.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 border bg-white dark:bg-[#101826] text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-white/10 hover:border-blue-500 transition-colors cursor-pointer"
                          title="เปิดระบบแก้ไขข้อมูลสินค้าแบบกลุ่ม (Batch Update)"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>แก้ไขกลุ่ม</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Category Segmented Bar */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5 text-xs">
                    <button
                      onClick={() => setSelectedCategory('ทั้งหมด')}
                      className={`eng-chip shrink-0 ${selectedCategory === 'ทั้งหมด' ? 'eng-chip-active' : ''}`}
                    >
                      ทุกหมวดหมู่
                    </button>
                    {categoryList.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`eng-chip shrink-0 ${selectedCategory === cat ? 'eng-chip-active' : ''}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Multi-Select Active Action Bar */}
              {isMultiSelectMode && (
                <div className="sticky top-[calc(env(safe-area-inset-top,0px)+52px)] z-25 px-3.5 sm:px-5 md:px-6 py-2 bg-blue-600 text-white shadow-md border-b border-blue-500">
                  <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center font-mono font-black text-xs text-white tabular-nums">
                        {selectedItemIds.size}
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold leading-tight">
                          เลือกแล้ว {selectedItemIds.size} จาก {filteredItems.length} รายการ
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap ml-auto">
                      <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        เลือกทั้งหมด ({filteredItems.length})
                      </button>

                      {selectedItemIds.size > 0 && (
                        <button
                          type="button"
                          onClick={handleClearSelection}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                        >
                          ล้างที่เลือก
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleToggleMultiSelectMode}
                        className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        ปิดโหมดเลือก
                      </button>

                      {currentUser?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setIsBatchUpdateModalOpen(true)}
                          disabled={selectedItemIds.size === 0}
                          className={`px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors ${
                            selectedItemIds.size > 0
                              ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 cursor-pointer'
                              : 'bg-white/20 text-white/50 cursor-not-allowed'
                          }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-950" />
                          <span>แก้ไขพร้อมกัน ({selectedItemIds.size})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleOpenBulkModal}
                        disabled={selectedItemIds.size === 0}
                        className={`px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors ${
                          selectedItemIds.size > 0
                            ? 'bg-white text-blue-700 hover:bg-blue-50 cursor-pointer'
                            : 'bg-white/30 text-white/60 cursor-not-allowed'
                        }`}
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        <span>เบิกพร้อมกัน ({selectedItemIds.size})</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Inventory List Body */}
              <main className="p-3 sm:p-4 md:p-5 space-y-3 flex-1 max-w-7xl mx-auto w-full min-w-0 overflow-x-hidden">
                {loading ? (
                  <InventorySkeleton count={6} />
                ) : error ? (
                  <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300 p-5 rounded-2xl text-sm space-y-2">
                    <p className="font-bold">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>
                    <p>{error}</p>
                    <button
                      onClick={() => fetchInventory(true)}
                      className="h-11 px-4 bg-red-600 text-white rounded-xl font-semibold text-sm hover:bg-red-700 transition-colors cursor-pointer"
                    >
                      ลองใหม่อีกครั้ง
                    </button>
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="text-center py-16 px-6 bg-white dark:bg-[#101826] rounded-3xl border border-dashed border-slate-300 dark:border-white/15 text-slate-400 dark:text-slate-500 shadow-sm">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                      <Package className="w-6 h-6" />
                    </div>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">ไม่พบรายการอะไหล่ที่ค้นหา</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวดหมู่ด้านบน</p>
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCategory('ทั้งหมด');
                        setStatusFilter('all');
                      }}
                      className="mt-4 h-11 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-500 transition-colors cursor-pointer"
                    >
                      แสดงอะไหล่ทั้งหมด
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3 w-full min-w-0">
                    {/* Active Filter Status Bar */}
                    {(statusFilter !== 'all' || selectedCategory !== 'ทั้งหมด' || searchQuery) && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                          <span>พบ <strong className="font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums">{filteredItems.length}</strong> รายการ</span>
                          {selectedCategory !== 'ทั้งหมด' && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              หมวด: {selectedCategory}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedCategory('ทั้งหมด');
                            setStatusFilter('all');
                          }}
                          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          ล้างตัวกรอง
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-3.5 w-full min-w-0 inventory-grid">
                      {filteredItems.map((item, index) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          index={index}
                          onClick={handleCardClick}
                          isMultiSelectMode={isMultiSelectMode}
                          isSelected={selectedItemIds.has(item.id)}
                          onToggleSelect={handleToggleSelectItem}
                          onLongPress={handleItemLongPress}
                          isRecentlyUpdated={recentlyUpdatedItemIds.has(item.id)}
                          isLowSpec={deviceInfo.isLowSpec}
                          onOrderClick={handleOpenOrderModal}
                          onQuickRequisition={handleOpenRequisitionModal}
                          isFavorite={favoriteItemIds.has(item.id)}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </main>
            </motion.div>
          )}

          {/* TAB 2: Requisition History (หน้าประวัติการเบิกของ) */}
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col pb-28 sm:pb-32"
            >
              <RequisitionView
                records={requisitions}
                items={items}
                isAdmin={currentUser?.role === 'admin'}
                onOpenNewRequisition={() => handleOpenRequisitionModal()}
                onStartMultiSelect={() => handleStartMultiSelect()}
                onDeleteRecord={handleDeleteRequisition}
                onEditRecord={(record) => {
                  setRequisitionToEdit(record);
                  setIsEditRequisitionModalOpen(true);
                }}
              />
            </motion.div>
          )}

          {/* TAB: Orders & Procurement (สั่งของ) - Accessible to both Staff and Admin */}
          {activeTab === 'orders' && (
            <motion.div
              key="orders-mode"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col pb-28 sm:pb-32"
            >
              <OrdersManagementView
                orders={orders}
                items={items}
                currentUser={currentUser}
                onConfirmOrder={handleConfirmOrder}
                onReceiveOrder={handleReceiveOrder}
                onCancelOrder={handleCancelOrder}
                onResendLineNotification={handleResendLineNotification}
                onOpenCreateOrder={(item) => {
                  setOrderModalItem(item || null);
                  setIsCreateOrderModalOpen(true);
                }}
                onOpenLineSettings={() => {
                  setLineSettingsInitialTab('line');
                  setIsLineSettingsModalOpen(true);
                }}
              />
            </motion.div>
          )}

          {/* TAB 4: Dashboard Stats */}
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col pb-28 sm:pb-32"
            >
              <StatsDashboard
                summary={summary}
                items={items}
                requisitions={requisitions}
                isLowSpec={deviceInfo.isLowSpec}
                onSelectCategory={(cat) => {
                  setSelectedCategory(cat);
                  setActiveTab('inventory');
                }}
                onFilterLowStock={() => {
                  setStatusFilter('low_or_out');
                  setActiveTab('inventory');
                }}
                onSelectItem={(item) => setSelectedItem(item)}
                onAskAI={(prompt) => handleAskAIQuery(prompt)}
                onRefresh={() => fetchInventory(true)}
                loading={refreshing}
              />
            </motion.div>
          )}

          {/* TAB 5: Categories View */}
          {activeTab === 'categories' && (
            <motion.div
              key="categories"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col pb-28 sm:pb-32"
            >
              <CategoryView
                summary={summary}
                items={items}
                isLowSpec={deviceInfo.isLowSpec}
                onSelectCategory={(cat) => {
                  setSelectedCategory(cat);
                  setActiveTab('inventory');
                }}
              />
            </motion.div>
          )}

          {/* TAB 6: Admin Console & All Admin Functions */}
          {(activeTab === 'admin' || activeTab === 'users') && currentUser?.role === 'admin' && (
            <motion.div
              key="admin-hub"
              initial={deviceInfo.isLowSpec ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={deviceInfo.isLowSpec ? undefined : { opacity: 0 }}
              transition={{ duration: deviceInfo.isLowSpec ? 0 : 0.14 }}
              className="flex-1 flex flex-col"
            >
              <AdminHubView 
                currentUser={currentUser} 
                onUpdateCurrentUser={handleUpdateCurrentUser}
                onOpenAddItem={handleOpenAddItemModal}
                onOpenNotificationSettings={(tab) => {
                  setLineSettingsInitialTab(tab || 'line');
                  setIsLineSettingsModalOpen(true);
                }}
                onExportInventoryPdf={handleExportInventoryPdf}
                isExportingInventoryPdf={isExportingInventoryPdf}
                summary={summary}
                items={items}
                requisitions={requisitions}
                orders={orders}
                onConfirmOrder={handleConfirmOrder}
                onReceiveOrder={handleReceiveOrder}
                onCancelOrder={handleCancelOrder}
                onResendLineNotification={handleResendLineNotification}
                onOpenCreateOrder={(item) => {
                  setOrderModalItem(item || null);
                  setIsCreateOrderModalOpen(true);
                }}
                onOpenBatchUpdate={() => {
                  if (!isMultiSelectMode) {
                    setIsMultiSelectMode(true);
                  }
                  setIsBatchUpdateModalOpen(true);
                }}
                onNavigateToTab={(tab) => setActiveTab(tab)}
                onFilterLowStock={() => {
                  setStatusFilter('low_or_out');
                  setActiveTab('inventory');
                }}
                onEditItem={(item) => {
                  setItemToEdit(item);
                  setIsEditItemModalOpen(true);
                }}
                isGeoLocationEnabled={isGeoLocationEnabled}
                onToggleGeoLocation={handleToggleGeoLocation}
                geoConfig={geoConfig}
                onUpdateGeoConfig={handleUpdateGeoConfig}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating indicator when Live speech is active in background */}
        {isLiveActive && activeTab !== 'voice' && (
          <div 
            onClick={() => setActiveTab('voice')}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-40 bg-red-600/95 hover:bg-red-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-full shadow-lg shadow-red-600/30 flex items-center gap-2 cursor-pointer backdrop-blur-xs transition-all ring-2 ring-red-300 dark:ring-red-900 animate-pulse"
          >
            <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
            <span>🎙️ กำลังคุยสดกับ AI (แตะเพื่อกลับไปหน้าถาม AI / ปิด)</span>
          </div>
        )}

        {/* TAB 3: AI Assistant View (Kept mounted to maintain Live audio stream across tabs) */}
        <div className={activeTab === 'voice' ? "flex-1 flex flex-col min-h-0 h-full overflow-hidden" : "hidden"}>
          <VoiceAssistantView
            items={items}
            requisitions={requisitions}
            orders={orders}
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            onSelectItem={(item) => setSelectedItem(item)}
            onExecuteDbAction={handleExecuteDbAction}
            onOpenHistory={() => setActiveTab('history')}
            pendingQuery={pendingQuery}
            clearPendingQuery={() => setPendingQuery('')}
            currentUser={currentUser!}
            onLiveStateChange={setIsLiveActive}
            isGeoLocationEnabled={isGeoLocationEnabled}
          />
        </div>

        {/* Item Detail Modal */}
        <AnimatePresence>
          {selectedItem && (
            <ItemDetailModal
              key={`item-detail-${selectedItem.id}`}
              item={selectedItem}
              isAdmin={currentUser?.role === 'admin'}
              onClose={() => setSelectedItem(null)}
              onAskAI={handleAskAIAboutItem}
              onStartRequisition={(item) => handleOpenRequisitionModal(item)}
              onEditItem={(item) => {
                setItemToEdit(item);
                setIsEditItemModalOpen(true);
              }}
              onOrderClick={handleOpenOrderModal}
              isFavorite={favoriteItemIds.has(selectedItem.id)}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
        </AnimatePresence>

        {/* Create Purchase Order Modal */}
        <AnimatePresence>
          {(isCreateOrderModalOpen || orderModalItem) && (
            <CreateOrderModal
              key={`create-order-${orderModalItem ? orderModalItem.id : 'custom'}`}
              isOpen={Boolean(isCreateOrderModalOpen || orderModalItem)}
              onClose={() => {
                setIsCreateOrderModalOpen(false);
                setOrderModalItem(null);
              }}
              item={orderModalItem}
              items={items}
              currentUser={currentUser}
              onSubmitOrder={handleSubmitOrder}
              isSubmitting={isSubmittingOrder}
            />
          )}
        </AnimatePresence>

        {/* Requisition Modal (บันทึกการเบิกของ) */}
        <AnimatePresence>
          {isRequisitionModalOpen && (
            <RequisitionModal
              key="requisition-modal"
              isOpen={isRequisitionModalOpen}
              preselectedItem={itemForRequisition}
              items={items}
              currentUser={currentUser}
              onClose={() => {
                setIsRequisitionModalOpen(false);
                setItemForRequisition(null);
              }}
              onSubmit={handleAddRequisition}
              onStartMultiSelect={(item) => handleStartMultiSelect(item)}
            />
          )}
        </AnimatePresence>

        {/* Bulk Requisition Modal (เบิกสินค้าพร้อมกันหลายรายการ) */}
        <AnimatePresence>
          {isBulkRequisitionModalOpen && (
            <BulkRequisitionModal
              key="bulk-requisition-modal"
              isOpen={isBulkRequisitionModalOpen}
              selectedItems={selectedItemsForBulk}
              currentUser={currentUser}
              onClose={() => setIsBulkRequisitionModalOpen(false)}
              onRemoveItem={(itemId) => {
                setSelectedItemIds((prev) => {
                  const next = new Set(prev);
                  next.delete(itemId);
                  return next;
                });
              }}
              onSubmit={handleBulkRequisitionSubmit}
            />
          )}
        </AnimatePresence>

        {/* Batch Update Modal (สำหรับ Admin แก้ไขสถานที่เก็บ / Min Stock พร้อมกัน) */}
        <AnimatePresence>
          {isBatchUpdateModalOpen && (
            <BatchUpdateModal
              key="batch-update-modal"
              isOpen={isBatchUpdateModalOpen}
              selectedItems={items.filter(item => selectedItemIds.has(item.id))}
              allItems={items}
              allLocations={Array.from(new Set(items.map(i => i.location).filter(Boolean) as string[]))}
              onClose={() => setIsBatchUpdateModalOpen(false)}
              onRemoveItem={(itemId) => {
                setSelectedItemIds((prev) => {
                  const next = new Set(prev);
                  next.delete(itemId);
                  return next;
                });
              }}
              onToggleItemSelect={(itemId) => {
                setSelectedItemIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(itemId)) next.delete(itemId);
                  else next.add(itemId);
                  return next;
                });
              }}
              onSelectAll={() => {
                setSelectedItemIds(new Set(items.map(i => i.id)));
              }}
              onApply={handleApplyBatchUpdate}
            />
          )}
        </AnimatePresence>

        {/* Edit Item Modal (สำหรับ Admin แก้ไขข้อมูลสินค้า) */}
        <AnimatePresence>
          {isEditItemModalOpen && itemToEdit && (
            <EditItemModal
              key={`edit-item-${itemToEdit.id}`}
              isOpen={isEditItemModalOpen}
              item={itemToEdit}
              categories={categoryList}
              onClose={() => {
                setIsEditItemModalOpen(false);
                setItemToEdit(null);
              }}
              onSave={handleSaveEditedItem}
              onDelete={handleDeleteItem}
            />
          )}
        </AnimatePresence>

        {/* Edit Requisition Modal (สำหรับ Admin แก้ไขประวัติการเบิก/รับเข้า) */}
        <AnimatePresence>
          {isEditRequisitionModalOpen && requisitionToEdit && (
            <EditRequisitionModal
              key={`edit-req-${requisitionToEdit.id}`}
              isOpen={isEditRequisitionModalOpen}
              record={requisitionToEdit}
              items={items}
              onClose={() => {
                setIsEditRequisitionModalOpen(false);
                setRequisitionToEdit(null);
              }}
              onSave={handleSaveEditedRequisition}
              onDelete={handleDeleteRequisition}
            />
          )}
        </AnimatePresence>

        {/* Geo-location Restriction Modal */}
        <GeoRestrictionModal
          state={geoModalState}
          onClose={closeGeoModal}
          onRetry={recheckLocation}
          isChecking={isCheckingGeo}
        />

        {/* Transaction Success Modal with Voice Announcement */}
        <TransactionSuccessModal
          isOpen={!!transactionSuccess}
          data={transactionSuccess}
          onClose={() => setTransactionSuccess(null)}
        />

        {/* Error Alert Modal */}
        <AnimatePresence>
          {dbErrorAlert && (
            <ModalPortal>
              <div 
                className="fixed inset-0 z-[120] flex items-center justify-center p-4 overscroll-contain"
                onTouchMove={(e) => {
                  if (e.target === e.currentTarget) {
                    e.preventDefault();
                  }
                }}
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDbErrorAlert(null)}
                  style={{ willChange: 'opacity' }}
                  className="fixed inset-0 bg-slate-950/80 transform-gpu touch-none"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  style={{ willChange: 'transform, opacity' }}
                  className="relative z-10 bg-white dark:bg-slate-900 rounded-[30px] sm:rounded-[34px] w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 transform-gpu"
                >
                  <div className="bg-gradient-to-r from-red-600 to-rose-600 p-4.5 text-white flex items-center gap-3 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
                    <XCircle className="w-5 h-5 sm:w-6 sm:h-6 relative z-10" />
                    <h2 className="font-bold text-base sm:text-lg relative z-10">รายการไม่สำเร็จ</h2>
                  </div>
                  <div className="p-5 sm:p-6">
                    <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 mb-5 font-medium leading-relaxed">
                      {dbErrorAlert}
                    </p>
                    <div className="flex justify-end">
                      <button 
                        onClick={() => setDbErrorAlert(null)}
                        className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                      >
                        ปิดหน้าต่าง
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            </ModalPortal>
          )}
        </AnimatePresence>

        {/* Low Stock Alert Modal */}
        <AnimatePresence>
          {showLowStockAlert && summary && (summary.lowStockCount > 0 || summary.outOfStockCount > 0) && (
            <ModalPortal>
              <div 
                className="fixed inset-0 z-[120] flex items-center justify-center p-4 overscroll-contain"
                onTouchMove={(e) => {
                  if (e.target === e.currentTarget) {
                    e.preventDefault();
                  }
                }}
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowLowStockAlert(false)}
                  style={{ willChange: 'opacity' }}
                  className="fixed inset-0 bg-slate-950/80 transform-gpu touch-none"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  style={{ willChange: 'transform, opacity' }}
                  className="relative z-10 bg-white dark:bg-slate-900 rounded-[30px] sm:rounded-[34px] w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 transform-gpu"
                >
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-4.5 text-white flex items-center gap-3 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
                    <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 relative z-10" />
                    <h2 className="font-bold text-base sm:text-lg relative z-10">แจ้งเตือนสินค้าสต็อกต่ำ!</h2>
                  </div>
                  <div className="p-5 sm:p-6">
                    <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
                      พบว่ามีสินค้า <b className="text-amber-600 dark:text-amber-400 font-bold">{summary.lowStockCount || 0}</b> รายการใกล้หมด และ <b className="text-red-600 dark:text-red-400 font-bold">{summary.outOfStockCount || 0}</b> รายการหมดสต็อกแล้ว<br/><br/>
                      <span className="text-red-600 dark:text-red-400 font-semibold">กรุณาตรวจสอบและดำเนินการเขียนใบสั่งซื้อ (PR) เพื่อเติมสต็อกโดยด่วน</span>
                    </p>
                    <div className="flex justify-end gap-2.5">
                      <button 
                        onClick={() => setShowLowStockAlert(false)}
                        className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl font-semibold text-xs sm:text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                      >
                        ปิดหน้าต่าง
                      </button>
                      <button 
                        onClick={() => {
                          setShowLowStockAlert(false);
                          setStatusFilter('low');
                          setActiveTab('inventory');
                        }}
                        className="px-4.5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl font-bold text-xs sm:text-sm hover:from-amber-400 hover:to-orange-400 transition-all cursor-pointer shadow-md shadow-amber-500/25 border border-amber-300/40"
                      >
                        ดูรายการสินค้า
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            </ModalPortal>
          )}
        </AnimatePresence>

        {/* Logout Confirmation Popup */}
        <AnimatePresence>
          {showLogoutConfirm && (
            <ModalPortal>
              <div 
                className="fixed inset-0 z-[120] flex items-center justify-center p-4 overscroll-contain"
                onTouchMove={(e) => {
                  if (e.target === e.currentTarget) {
                    e.preventDefault();
                  }
                }}
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowLogoutConfirm(false)}
                  style={{ willChange: 'opacity' }}
                  className="fixed inset-0 bg-slate-950/80 transform-gpu touch-none"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  style={{ willChange: 'transform, opacity' }}
                  className="relative z-10 bg-white dark:bg-slate-900 rounded-[32px] sm:rounded-[36px] w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 transform-gpu"
                >
                  <div className="p-6 sm:p-7 text-center">
                    <div className="w-16 h-16 rounded-[24px] bg-red-500/15 dark:bg-red-500/20 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center mb-4 shadow-inner border border-red-400/20">
                      <LogOut className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">ยืนยันการออกจากระบบ</h3>
                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-6 leading-relaxed">
                      คุณต้องการออกจากระบบบัญชี <span className="font-bold text-slate-900 dark:text-white">{currentUser.name}</span> ใช่หรือไม่?
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={isLoggingOut}
                        onClick={() => setShowLogoutConfirm(false)}
                        className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer border border-slate-200 dark:border-slate-700"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        disabled={isLoggingOut}
                        onClick={handleConfirmLogout}
                        className="flex-1 py-3 px-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-2xl font-bold text-sm transition-all shadow-md shadow-red-600/30 active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer border border-red-400/40"
                      >
                        {isLoggingOut ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>กำลังออก...</span>
                          </>
                        ) : (
                          <span>ออกจากระบบ</span>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            </ModalPortal>
          )}
        </AnimatePresence>

        {/* Mobile Bottom Navigation Bar: always visible on preview, mobile, and tablet devices */}
        <div>
          <MobileNavbar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            lowStockCount={summary?.lowStockCount || 0}
            requisitionCount={requisitions.length}
            pendingOrdersCount={pendingOrdersCount}
            isAdmin={currentUser?.role === 'admin'}
            isLiveActive={isLiveActive}
          />
        </div>

        {/* Toast Notifications Container */}
        {toasts.length > 0 && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[110] w-full max-w-sm px-4 pointer-events-none">
            <div className="pointer-events-auto space-y-2">
              {toasts.map((toast) => (
                <Toast key={toast.id} toast={toast} onClose={removeToast} />
              ))}
            </div>
          </div>
        )}

        {/* Offline Status & Connectivity Indicator */}
        <OfflineIndicator />

        {/* LINE Notification Settings Modal */}
        <LineSettingsModal
          isOpen={isLineSettingsModalOpen}
          onClose={() => setIsLineSettingsModalOpen(false)}
          currentUser={currentUser}
          initialTab={lineSettingsInitialTab}
        />

        {/* Font Settings & Live Preview Modal */}
        <FontSettingsModal
          isOpen={isFontModalOpen}
          onClose={() => setIsFontModalOpen(false)}
          currentFont={currentFont}
          onSelectFont={handleSelectFont}
        />
      </div>
    </div>
  );
}
