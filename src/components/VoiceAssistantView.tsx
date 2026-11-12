import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { InventoryItem, ChatMessage, RequisitionRecord, ReportAction, DbActionPayload, PurchaseOrder } from '../types';
import {  
  Mic, MicOff, Send, Sparkles, 
  RotateCcw, Bot, User, ArrowRight, Loader2, FileDown, FileText, 
  ArrowDownRight, ArrowUpRight, Sliders, Trash2, ExternalLink, AlertCircle, Headset, Radio,
  CheckCircle2, XCircle, Check, X, Clock, Package, MapPin, Layers, Volume2, Globe, Square,
  Users, Calendar, Shield
} from 'lucide-react';
import { generateAndDownloadPdf } from '../utils/pdfGenerator';
import { generateAndDownloadExcel } from '../utils/excelGenerator';
import { formatRecordTimestamp } from '../utils/dateUtils';
import { useGeolocationAuth } from '../hooks/useGeolocationAuth';
import { useLiveAudio } from '../hooks/useLiveAudio';
import { GeoRestrictionModal } from './GeoRestrictionModal';
import { EngLogo } from './EngLogo';
import { playSuccessSoundAndSpeak } from '../utils/audioUtils';
import { findEmployeeInSystem, SYSTEM_EMPLOYEES } from '../utils/employeeDirectory';

interface VoiceAssistantViewProps {
  items: InventoryItem[];
  requisitions: RequisitionRecord[];
  orders?: PurchaseOrder[];
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  currentUser: { name: string; username?: string; role?: string; nickname?: string; id?: string };
  onSelectItem: (item: InventoryItem) => void;
  onExecuteDbAction?: (action: DbActionPayload) => void;
  onOpenHistory?: () => void;
  pendingQuery?: string;
  clearPendingQuery?: () => void;
  onLiveStateChange?: (connected: boolean) => void;
  isGeoLocationEnabled?: boolean;
}

export const VoiceAssistantView: React.FC<VoiceAssistantViewProps> = ({
  items,
  requisitions,
  orders = [],
  chatHistory,
  setChatHistory,
  currentUser,
  onSelectItem,
  onExecuteDbAction,
  onOpenHistory,
  pendingQuery,
  clearPendingQuery,
  onLiveStateChange,
  isGeoLocationEnabled = true,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);
  const {
    verifyLocation,
    isCheckingGeo,
    geoModalState,
    closeGeoModal,
    recheckLocation,
  } = useGeolocationAuth(currentUser as any, isGeoLocationEnabled);
  const liveMessageIdRef = useRef<string | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const stopCurrentQuery = useCallback(() => {
    if (chatAbortControllerRef.current) {
      try {
        chatAbortControllerRef.current.abort();
      } catch (e) {}
      chatAbortControllerRef.current = null;
    }
    setIsProcessing(false);
  }, []);

  // Download handler for PDF & Excel (Strictly restricted to Admin)
  const handleDownloadReport = useCallback(async (report: any, msgId: string, isExcel: boolean = false) => {
    if (currentUser?.role !== 'admin') {
      alert('🔒 ขออภัยด้วยนะคะ: การดาวน์โหลดรายงานเอกสาร PDF สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นค่ะ');
      return;
    }
    try {
      setGeneratingPdfId(msgId);
      if (isExcel || report.format === 'excel') {
        await generateAndDownloadExcel({
          type: report.type,
          title: report.title,
          categoryFilter: report.categoryFilter,
          userFilter: report.userFilter,
          items,
          requisitions,
        });
      } else {
        await generateAndDownloadPdf({
          type: report.type || 'inventory_all',
          title: report.title,
          subtitle: report.subtitle,
          categoryFilter: report.categoryFilter,
          userFilter: report.userFilter,
          orderStatusFilter: report.orderStatusFilter,
          startDate: report.startDate,
          endDate: report.endDate,
          startTime: report.startTime,
          endTime: report.endTime,
          items,
          requisitions,
          orders,
          generatedBy: currentUser?.name || currentUser?.username || 'Admin',
        });
      }
    } catch (err) {
      console.error('Error generating report:', err);
      alert('เกิดข้อผิดพลาดในการสร้างไฟล์');
    } finally {
      setGeneratingPdfId(null);
    }
  }, [items, requisitions, orders, currentUser]);

  const handleLiveToolCall = useCallback((toolCall: any) => {
    if (!toolCall) return;

    // 1. Stock Action (Stock In / Stock Out / Requisition)
    if (toolCall.name === 'prepare_stock_action') {
      const { action, itemId, quantity, purpose, note } = toolCall.args || {};
      const targetItem = items.find(i => 
        i.id === itemId || 
        i.name.toLowerCase() === (itemId || '').toLowerCase() ||
        i.name.toLowerCase().includes((itemId || '').toLowerCase())
      );
      
      if (!targetItem) {
         setChatHistory(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            source: 'live',
            text: `ไม่พบสินค้าที่มีรหัสหรือชื่อ "${itemId}" ในคลัง Store กรุณาตรวจสอบชื่อสินค้าอีกครั้ง`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
         }]);
         return;
      }

      const isStockIn = action === 'stock_in';
      const actionQty = Math.max(1, Number(quantity) || 1);
      const prevQty = targetItem.qty;
      const newQty = isStockIn ? prevQty + actionQty : Math.max(0, prevQty - actionQty);
      let newStatus = 'normal';
      if (newQty <= 0) newStatus = 'out'; else if (newQty <= targetItem.minStock) newStatus = 'low';

      const updatedItem = { ...targetItem, qty: newQty, status: newStatus as any };
      const recordData = {
          id: `${Date.now().toString().slice(-6)}`,
          type: isStockIn ? 'in' as const : 'out' as const,
          itemId: targetItem.id,
          itemName: targetItem.name,
          category: targetItem.category,
          unit: targetItem.unit,
          qty: actionQty,
          user: currentUser?.name || 'ผู้ใช้งาน',
          requestedBy: currentUser?.name || 'ผู้ใช้งาน',
          purpose: purpose || note || (isStockIn ? 'รับเข้าสต็อก' : 'เบิกไปใช้งาน'),
          isoDate: new Date().toISOString(),
          timestamp: new Date().toLocaleString('th-TH', { 
            timeZone: 'Asia/Bangkok',
            day: 'numeric', month: 'short', year: 'numeric', 
            hour: '2-digit', minute: '2-digit',
            hour12: false
          }) + ' น.',
          note: note || 'บันทึกผ่านเสียงพูด Live Speech'
      };

      const dbAction: DbActionPayload = {
          action: (isStockIn ? 'stock_in' : 'requisition') as 'stock_in' | 'requisition',
          status: 'success' as const,
          message: `บันทึกรายการสำเร็จ`,
          item: updatedItem,
          previousQty: prevQty,
          newQty: newQty,
          record: recordData
      };

      // Set pending confirmation (requires user to tap confirm button before executing DB update)
      setChatHistory(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          source: 'live',
          text: `กรุณาตรวจสอบข้อมูลและกดยืนยันการทำรายการ: ${isStockIn ? 'รับเข้า' : 'เบิก'} ${targetItem.name} จำนวน ${actionQty} ${targetItem.unit}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isPendingConfirmation: true,
          dbAction: dbAction
      }]);
    }

    // 2. Export Report (PDF / Excel) - STRICTLY RESTRICTED TO ADMIN ONLY
    else if (toolCall.name === 'export_report') {
      const callingName = currentUser?.nickname || currentUser?.name || 'ผู้ใช้งาน';

      // Strict RBAC: Only Admin can command PDF reports via Live Speech / AI Assistant!
      if (currentUser?.role !== 'admin') {
        const msgId = Date.now().toString();
        setChatHistory(prev => [...prev, {
          id: msgId,
          role: 'assistant',
          source: 'live',
          text: `🔒 ขออภัยด้วยนะคะคุณ ${callingName} การสั่งออกรายงาน PDF ในระบบ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นค่ะ หากต้องการตรวจสอบสต็อกหรือสั่งเบิกของ สามารถบอกหนูได้ตามปกติเลยนะคะ ✨`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        return;
      }

      const { 
        format, 
        reportType = 'inventory_all', 
        title, 
        userFilter, 
        categoryFilter, 
        orderStatusFilter, 
        startDate, 
        endDate, 
        startTime, 
        endTime 
      } = toolCall.args || {};

      const isExcel = (format || '').toLowerCase() === 'excel';
      
      let defaultTitle = 'รายงานคลังสินค้า';
      let finalUserFilter = userFilter;
      const matchedEmp = findEmployeeInSystem(userFilter);
      let isVerified: boolean | undefined = undefined;

      if (reportType === 'individual_requisitions' || (reportType === 'requisition_history' && userFilter)) {
        if (matchedEmp) {
          finalUserFilter = matchedEmp.name;
          isVerified = true;
          defaultTitle = `รายงานประวัติการเบิก-รับสินค้ารายบุคคล: ${matchedEmp.name} (${matchedEmp.nickname}) [รหัส: ${matchedEmp.id}]`;
        } else if (userFilter) {
          isVerified = false;
          defaultTitle = `รายงานประวัติการเบิก-รับสินค้ารายบุคคล: ${userFilter}`;
        } else {
          defaultTitle = 'รายงานประวัติการเบิก-รับสินค้ารายบุคคล (โปรดระบุพนักงาน)';
        }
      } else if (reportType === 'requisition_history') {
        defaultTitle = 'รายงานประวัติการเบิก-รับเข้าสินค้าทั้งหมด';
      } else if (reportType === 'purchase_orders') {
        defaultTitle = 'รายงานประวัติและสถานะการสั่งซื้อสินค้า (PO)';
      } else if (reportType === 'low_stock') {
        defaultTitle = 'รายงานสินค้าใกล้หมดและหมดสต็อก';
      } else if (reportType === 'executive_summary') {
        defaultTitle = 'รายงานสรุปภาพรวมผู้บริหาร';
      } else {
        defaultTitle = 'รายงานสต็อกสินค้าคงคลังทั้งหมด';
      }

      const isIndividualReport = (reportType === 'individual_requisitions' || Boolean(finalUserFilter));

      const reportAction: ReportAction = {
        format: isExcel ? 'excel' : 'pdf',
        type: (reportType === 'category' ? 'inventory_all' : reportType) || 'inventory_all',
        title: title || defaultTitle,
        userFilter: finalUserFilter,
        categoryFilter,
        orderStatusFilter,
        startDate,
        endDate,
        startTime,
        endTime,
        requestedBy: callingName,
        isConfirmed: !isIndividualReport,
        employeeId: matchedEmp?.id,
        employeeName: matchedEmp?.name,
        employeeNickname: matchedEmp?.nickname,
        employeeThaiName: matchedEmp?.thaiName,
        isEmployeeVerified: isVerified,
      };

      const msgId = Date.now().toString();

      setChatHistory(prev => [...prev, {
        id: msgId,
        role: 'assistant',
        source: 'live',
        text: isIndividualReport 
          ? `กรุณาตรวจสอบชื่อและรหัสพนักงานในระบบสำหรับออกรายงานรายบุคคล: "${reportAction.title}" (${isExcel ? 'EXCEL' : 'PDF'}) ก่อนกดยืนยันค่ะ`
          : `จัดเตรียมเอกสารรายงาน "${reportAction.title}" (${isExcel ? 'EXCEL' : 'PDF'}) เรียบร้อยแล้วค่ะ สามารถเปิด/ดาวน์โหลดได้ทันทีค่ะ`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fileReports: [reportAction],
        isPendingConfirmation: isIndividualReport,
      }]);
    }

    // 3. Inquire Item Info & Check Stock
    else if (toolCall.name === 'inquire_item_info' || toolCall.name === 'check_stock') {
      const { searchTerm } = toolCall.args || {};
      const term = (searchTerm || '').trim().toLowerCase();
      const tokens = term.split(/\s+/).filter((t: string) => t.length > 0);
      const matched = items.filter(i => {
        const n = (i.name || '').toLowerCase();
        const id = (i.id || '').toLowerCase();
        const c = (i.category || '').toLowerCase();
        return tokens.length === 0 || tokens.every((t: string) => n.includes(t) || id.includes(t) || c.includes(t));
      });

      let textOutput = '';
      if (matched.length === 1) {
        textOutput = `📦 พบรายการสินค้า 1 รายการ`;
      } else if (matched.length > 1) {
        textOutput = `📦 พบรายการสินค้า มีจำนวน ${matched.length} รายการ`;
      } else {
        textOutput = `🔍 ไม่พบรายการสินค้าที่ตรงกับ "${searchTerm || 'คำค้นหา'}" ในคลัง Store FL.6 ค่ะ`;
      }

      setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        source: 'live',
        text: textOutput,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedItems: matched.length > 0 ? matched : undefined
      }]);
    }

    // 4. Out of stock items
    else if (toolCall.name === 'get_out_of_stock_items') {
      const outItems = items.filter(i => (Number(i.qty) || 0) <= 0 || i.status === 'out');
      const text = outItems.length > 0 
        ? `🚨 สินค้าหมดแล้ว มีจำนวน ${outItems.length} รายการ`
        : `✅ ขณะนี้ไม่มีรายการสินค้าหมดสต็อกในคลัง ทุกรายการพร้อมใช้งานค่ะ`;

      setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        source: 'live',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedItems: outItems.length > 0 ? outItems : undefined
      }]);
    }

    // 5. Low stock items
    else if (toolCall.name === 'get_low_stock_items') {
      const lowItems = items.filter(i => ((Number(i.qty) || 0) > 0 && (Number(i.qty) || 0) <= (Number(i.minStock) || 1)) || (i.status === 'low' && (Number(i.qty) || 0) > 0));
      const text = lowItems.length > 0 
        ? `⚠️ สินค้าใกล้หมด มีจำนวน ${lowItems.length} รายการ`
        : `✅ ขณะนี้ไม่มีสินค้าใกล้หมดสต็อกในคลังค่ะ`;

      setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        source: 'live',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedItems: lowItems.length > 0 ? lowItems : undefined
      }]);
    }

    // 6. Extremes (min/max stock)
    else if (toolCall.name === 'get_stock_extremes') {
      const sorted = [...items].sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0));
      const extremeItems: InventoryItem[] = [];
      let text = `📊 ข้อมูลสินค้าคงเหลือน้อยที่สุดและมากที่สุดในคลัง`;
      if (sorted.length > 0) {
        extremeItems.push(sorted[0]);
        if (sorted.length > 1 && sorted[sorted.length - 1].id !== sorted[0].id) {
          extremeItems.push(sorted[sorted.length - 1]);
        }
        text = `📊 ข้อมูลสินค้าคงเหลือน้อยที่สุดและมากที่สุด มีจำนวน ${extremeItems.length} รายการ`;
      } else {
        text = `📊 ไม่พบข้อมูลสินค้าในระบบคลัง Store FL.6`;
      }

      setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        source: 'live',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedItems: extremeItems.length > 0 ? extremeItems : undefined
      }]);
    }

    // 7. Stock summary
    else if (toolCall.name === 'get_stock_summary') {
      const totalItems = items.length;
      const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      const outCount = items.filter(i => (Number(i.qty) || 0) <= 0 || i.status === 'out').length;
      const lowCount = items.filter(i => 
        ((Number(i.qty) || 0) > 0 && (Number(i.qty) || 0) <= (Number(i.minStock) || 1)) || 
        (i.status === 'low' && (Number(i.qty) || 0) > 0)
      ).length;

      const text = `### 📊 สรุปภาพรวมคลังสินค้า Store FL.6\n\n` +
        `• 📦 **จำนวนรายการสินค้าทั้งหมด:** **${totalItems} รายการ**  \n` +
        `• 🔢 **ปริมาณสต็อกรวมทั้งหมด:** **${totalQty.toLocaleString()} หน่วย**  \n` +
        `• 🚨 **สินค้าหมดสต็อก:** **${outCount} รายการ**  \n` +
        `• ⚠️ **สินค้าใกล้หมดเกณฑ์:** **${lowCount} รายการ**`;

      setChatHistory(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        source: 'live',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }
  }, [items, currentUser, setChatHistory, handleDownloadReport]);

  // Handle live spoken transcripts from Gemini
  const handleTranscript = useCallback((textChunk: string, isDone?: boolean) => {
    if (isDone) {
      if (liveMessageIdRef.current) {
        const currentId = liveMessageIdRef.current;
        setChatHistory(prev => prev.map(msg => {
          if (msg.id === currentId) {
            let suggestedItems = msg.suggestedItems;
            let formattedText = msg.text;
            const txtLower = msg.text.toLowerCase();

            if (!suggestedItems || suggestedItems.length === 0) {
              if (txtLower.includes('ใกล้หมด') || txtLower.includes('low stock') || txtLower.includes('เกณฑ์ขั้นต่ำ')) {
                const low = items.filter(i => {
                  const q = Number(i.qty) || 0;
                  const min = Number(i.minStock) || 1;
                  return q > 0 && (q <= min || i.status === 'low');
                });
                if (low.length > 0) suggestedItems = low.slice(0, 6);
              } else if (txtLower.includes('หมดสต็อก') || txtLower.includes('out of stock') || txtLower.includes('หมดแล้ว') || txtLower.includes('ไม่มีของ')) {
                const out = items.filter(i => (Number(i.qty) || 0) <= 0 || i.status === 'out');
                if (out.length > 0) suggestedItems = out.slice(0, 6);
              } else {
                const matches = items.filter(i => {
                  const idMatch = msg.text.includes(i.id);
                  const nameMatch = i.name.length >= 3 && txtLower.includes(i.name.toLowerCase());
                  return idMatch || nameMatch;
                });
                if (matches.length > 0) suggestedItems = matches.slice(0, 6);
              }
            }

            // If voice transcript has low/out stock items, format as a clean short header
            if (suggestedItems && suggestedItems.length > 0 && (txtLower.includes('ใกล้หมด') || txtLower.includes('หมดสต็อก') || txtLower.includes('หมดแล้ว') || txtLower.includes('low') || txtLower.includes('out'))) {
              const isLow = txtLower.includes('ใกล้หมด') || txtLower.includes('low');
              const isOut = txtLower.includes('หมดสต็อก') || txtLower.includes('out') || txtLower.includes('หมดแล้ว');
              
              if (isLow) {
                formattedText = `⚠️ สินค้าใกล้หมด มีจำนวน ${suggestedItems.length} รายการ`;
              } else if (isOut) {
                formattedText = `🚨 สินค้าหมดแล้ว มีจำนวน ${suggestedItems.length} รายการ`;
              }
            }

            return { ...msg, text: formattedText, suggestedItems };
          }
          return msg;
        }));
      }
      liveMessageIdRef.current = null;
      return;
    }
    if (!textChunk) return;

    if (!liveMessageIdRef.current) {
      const newId = `live-${Date.now()}`;
      liveMessageIdRef.current = newId;

      // Realtime detection of items to show cards immediately
      const txtLower = textChunk.toLowerCase();
      let initSuggested: InventoryItem[] | undefined = undefined;
      if (txtLower.includes('ใกล้หมด') || txtLower.includes('low stock')) {
        const low = items.filter(i => {
          const q = Number(i.qty) || 0;
          const min = Number(i.minStock) || 1;
          return q > 0 && (q <= min || i.status === 'low');
        });
        if (low.length > 0) initSuggested = low.slice(0, 6);
      } else if (txtLower.includes('หมดสต็อก') || txtLower.includes('out of stock')) {
        const out = items.filter(i => (Number(i.qty) || 0) <= 0 || i.status === 'out');
        if (out.length > 0) initSuggested = out.slice(0, 6);
      }

      setChatHistory(prev => [...prev, {
        id: newId,
        role: 'assistant',
        source: 'live',
        text: textChunk,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedItems: initSuggested
      }]);
    } else {
      const currentId = liveMessageIdRef.current;
      setChatHistory(prev => prev.map(msg => {
        if (msg.id === currentId) {
          const updatedText = msg.text + textChunk;
          let suggestedItems = msg.suggestedItems;
          if (!suggestedItems || suggestedItems.length === 0) {
            const txtLower = updatedText.toLowerCase();
            if (txtLower.includes('ใกล้หมด') || txtLower.includes('low stock')) {
              const low = items.filter(i => {
                const q = Number(i.qty) || 0;
                const min = Number(i.minStock) || 1;
                return q > 0 && (q <= min || i.status === 'low');
              });
              if (low.length > 0) suggestedItems = low.slice(0, 6);
            } else if (txtLower.includes('หมดสต็อก') || txtLower.includes('out of stock')) {
              const out = items.filter(i => (Number(i.qty) || 0) <= 0 || i.status === 'out');
              if (out.length > 0) suggestedItems = out.slice(0, 6);
            } else {
              const matches = items.filter(i => {
                const idMatch = updatedText.includes(i.id);
                const nameMatch = i.name.length >= 3 && txtLower.includes(i.name.toLowerCase());
                return idMatch || nameMatch;
              });
              if (matches.length > 0) suggestedItems = matches.slice(0, 6);
            }
          }
          return { ...msg, text: updatedText, suggestedItems };
        }
        return msg;
      }));
    }
  }, [items, setChatHistory]);

  const [liveUserSpokenText, setLiveUserSpokenText] = useState('');

  const handleUserTranscript = useCallback((userText: string) => {
    if (!userText || !userText.trim()) return;
    setLiveUserSpokenText(userText);
  }, []);

  const { 
    isLiveConnected, 
    isConnecting, 
    activeLiveModel,
    audioVolume,
    isAiSpeaking,
    isUserSpeaking,
    startLive, 
    stopLive, 
    sendMessage, 
    syncInventory 
  } = useLiveAudio(
    handleLiveToolCall,
    handleTranscript,
    onLiveStateChange,
    handleUserTranscript
  );

  // Sync real-time inventory to active Live Speech server session on changes
  useEffect(() => {
    if (isLiveConnected && items && items.length > 0) {
      syncInventory(items);
    }
  }, [items, isLiveConnected, syncInventory]);

  const isAdmin = currentUser?.role === 'admin';

  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Suggested quick prompts including DB operations & PDF generation (Admin only for PDF)
  const suggestedPrompts = isAdmin ? [
    '📦 เบิกแอลกอฮอล์ 2 แกลลอน เอาไปซ่อมแอร์ชั้น 4',
    '📥 รับเข้าน้ำยาประสานท่อ 3 กระป๋อง จากโฮมโปร',
    '📄 ออกรายงาน PDF ประวัติเบิกรายบุคคล',
    '📄 สรุปภาพรวมผู้บริหาร PDF',
  ] : [
    '📦 เบิกแอลกอฮอล์ 2 แกลลอน เอาไปซ่อมแอร์ชั้น 4',
    '📥 รับเข้าน้ำยาประสานท่อ 3 กระป๋อง จากโฮมโปร',
    '🔍 สอบถามจำนวนคงเหลือของ ท่อ PVC',
    '⚠️ เช็คสินค้าที่ใกล้หมดสต็อก',
  ];

  const lastProcessedQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingQuery && pendingQuery.trim() !== '') {
      if (lastProcessedQueryRef.current !== pendingQuery) {
        lastProcessedQueryRef.current = pendingQuery;
        sendQuery(pendingQuery);
        if (clearPendingQuery) clearPendingQuery();
      }
    } else {
      lastProcessedQueryRef.current = null;
    }
  }, [pendingQuery, clearPendingQuery]);

  // Check browser speech recognition support
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSpeechSupported(Boolean(SpeechRecognition));
    }
  }, []);

  // Start fresh Speech Recognition dictation session
  const startListening = () => {
    if (isProcessing) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('เบราว์เซอร์นี้ไม่รองรับไมโครโฟนสำหรับสั่งพิมพ์ด้วยเสียง กรุณาใช้ Google Chrome, Safari หรือ Edge บนมือถือหรือคอมพิวเตอร์');
      return;
    }

    // Stop and clean up any active instance first
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'th-TH';

      let lastRecognizedText = '';

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('');
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i] && event.results[i][0]) {
            currentTranscript += event.results[i][0].transcript;
          }
        }
        if (currentTranscript) {
          lastRecognizedText = currentTranscript;
          setTranscript(currentTranscript);
          setInputText(currentTranscript); // Real-time sync to text input field
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          alert('ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณากดอนุญาตการใช้งานไมโครโฟนในตั้งค่าเบราว์เซอร์ของคุณเพื่อสั่งพิมพ์ด้วยเสียง');
        } else if (event.error === 'network') {
          alert('เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่ายสำหรับระบบแปลงเสียงเป็นข้อความ');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        const finalText = lastRecognizedText.trim();
        if (finalText) {
          sendQuery(finalText);
          setTranscript('');
          setInputText('');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
      alert('ไม่สามารถเริ่มระบบรับเสียงได้ กรุณาตรวจสอบการตั้งค่าสิทธิ์ไมโครโฟน');
    }
  };

  // Stop Speech Recognition dictation session
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
  };

  // Toggle Voice Dictation Input
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // When form submitted or stop button clicked, send query
  const handleStopAndSend = (textToSend?: string) => {
    const text = textToSend || inputText || transcript;
    if (!text.trim()) return;

    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    sendQuery(text.trim());
    setTranscript('');
    setInputText('');
  };

  // Send query to AI
  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || isProcessing) return;

    if (chatAbortControllerRef.current) {
      try {
        chatAbortControllerRef.current.abort();
      } catch (e) {}
    }
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineAiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: '📡 ขณะนี้ระบบอยู่ในโหมดออฟไลน์ (Offline Mode) ไม่สามารถติดต่อ AI ได้ ข้อมูลสินค้าและประวัติการเบิกในเครื่องยังคงค้นหาและเปิดดูได้ตามปกติที่แท็บ "คลังสินค้า" ครับ',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory(prev => [...prev, userMessage, offlineAiMessage]);
      setInputText('');
      return;
    }

    setChatHistory(prev => [...prev, userMessage]);
    setIsProcessing(true);
    
    const aiMessageId = (Date.now() + 1).toString();
    let textBuffer = '';

    // Safety client timeout (60s) to allow seamless fallback without premature interruption
    const safetyTimeout = setTimeout(() => {
      if (!textBuffer) {
        console.warn('Chat request safety timeout reached, releasing UI');
        abortController.abort(new Error('SafetyTimeout'));
      }
    }, 60000);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: queryText,
          history: chatHistory.slice(-4),
          items, // Pass live inventory state
          requisitions, // Pass live requisition history
          currentUser, // Pass current user to AI
          isVoice: false,
        }),
      });

      if (!res.ok) throw new Error('Network response was not ok');
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');
      
      const decoder = new TextDecoder();
      let done = false;
      let jsonBuffer = '';
      let hasAddedAiMessage = false;

      while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
              const chunk = decoder.decode(value, { stream: true });
              jsonBuffer += chunk;
              
              const parts = jsonBuffer.split(/\r?\n\r?\n/);
              // keep the last part if it doesn't end with newline delimiter
              jsonBuffer = parts.pop() || '';
              
               for (const part of parts) {
                  const trimmed = part.trim();
                  if (trimmed.startsWith('data: ')) {
                      let serverError = null;
                      try {
                          const data = JSON.parse(trimmed.slice(6));
                          if (data.type === 'chunk' || data.type === 'complete' || data.type === 'done') {
                              if (data.type === 'chunk') {
                                textBuffer = textBuffer ? textBuffer + (data.text || '') : (data.text || '');
                              } else {
                                textBuffer = data.text || textBuffer || '';
                              }
                              let isPending = false;
                              if (data.dbAction && (data.dbAction.action === 'requisition' || data.dbAction.action === 'stock_in' || data.dbAction.action === 'update_stock')) {
                                  isPending = true;
                              } else if (data.fileReport || (data.fileReports && data.fileReports.length > 0)) {
                                  const rawReportsList: any[] = data.fileReports || (data.fileReport ? [data.fileReport] : []);
                                  // ONLY individual requisition reports require confirmation to prevent selecting the wrong employee
                                  isPending = rawReportsList.some(r => r.type === 'individual_requisitions' || Boolean(r.userFilter));
                              } else if (data.dbAction && data.dbAction.action !== 'error' && onExecuteDbAction) {
                                  onExecuteDbAction(data.dbAction);
                              }

                              const callingName = currentUser?.nickname || currentUser?.name || 'ผู้ใช้งาน';
                              let rawReports: ReportAction[] | undefined = data.fileReports || (data.fileReport ? [data.fileReport] : undefined);
                              if (rawReports && Array.isArray(rawReports)) {
                                rawReports = rawReports.map((r: any) => {
                                  const matchedEmp = findEmployeeInSystem(r.userFilter);
                                  let isVerified: boolean | undefined = undefined;
                                  let finalUserFilter = r.userFilter;
                                  let finalTitle = r.title;
                                  const isIndividual = (r.type === 'individual_requisitions' || Boolean(r.userFilter));

                                  if (r.type === 'individual_requisitions' || r.userFilter) {
                                    if (matchedEmp) {
                                      finalUserFilter = matchedEmp.name;
                                      isVerified = true;
                                      if (!finalTitle || finalTitle.includes('พนักงาน') || finalTitle.includes('ผู้ทำรายการ')) {
                                        finalTitle = `รายงานประวัติการเบิก-รับสินค้ารายบุคคล: ${matchedEmp.name} (${matchedEmp.nickname}) [รหัส: ${matchedEmp.id}]`;
                                      }
                                    } else if (r.userFilter) {
                                      isVerified = false;
                                    }
                                  }

                                  return {
                                    ...r,
                                    title: finalTitle || r.title,
                                    userFilter: finalUserFilter,
                                    requestedBy: r.requestedBy || callingName,
                                    isConfirmed: !isIndividual,
                                    employeeId: matchedEmp?.id,
                                    employeeName: matchedEmp?.name,
                                    employeeNickname: matchedEmp?.nickname,
                                    employeeThaiName: matchedEmp?.thaiName,
                                    isEmployeeVerified: isVerified,
                                  };
                                });
                              }

                              let finalText = (data.text || textBuffer || '').trim();
                              if (!finalText) {
                                if (rawReports && rawReports.length > 0) {
                                  finalText = `ทางระบบได้เตรียมเอกสารรายงาน ${rawReports[0].title || 'สรุปภาพรวมผู้บริหาร'} (Store FL.6) ให้เรียบร้อยแล้วครับ กรุณากดปุ่มเพื่อเปิดหรือดาวน์โหลดเอกสารด้านล่างได้เลยครับ`;
                                } else if (data.dbAction) {
                                  finalText = 'บันทึกคำสั่งและเตรียมรายการในระบบ Store FL.6 เรียบร้อยแล้วครับ';
                                } else {
                                  finalText = 'รับทราบคำสั่งเรียบร้อยครับ';
                                }
                              }

                              // Fallback client-side matching if server didn't provide suggestedItems
                              let finalSuggestedItems = data.suggestedItems;
                              if (!finalSuggestedItems && !data.dbAction && !rawReports) {
                                const fullText = (queryText + ' ' + finalText).toLowerCase();
                                const clientMatches = items.filter(item => {
                                  const idMatch = queryText.includes(item.id) || finalText.includes(item.id);
                                  const nameMatch = queryText.toLowerCase().includes(item.name.toLowerCase()) || 
                                                    (item.name.length >= 4 && fullText.includes(item.name.toLowerCase()));
                                  return idMatch || nameMatch;
                                });
                                if (clientMatches.length > 0) {
                                  finalSuggestedItems = clientMatches.slice(0, 4);
                                }
                              }

                              const completedMessage: ChatMessage = {
                                  id: aiMessageId,
                                  role: 'assistant',
                                  text: finalText,
                                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                  suggestedItems: finalSuggestedItems,
                                  fileReport: rawReports?.[0],
                                  fileReports: rawReports,
                                  dbAction: data.dbAction,
                                  isPendingConfirmation: isPending
                              };

                              if (!hasAddedAiMessage) {
                                hasAddedAiMessage = true;
                                setChatHistory(prev => [...prev.filter(m => m.id !== aiMessageId), completedMessage]);
                              } else {
                                setChatHistory(prev => prev.map(msg => msg.id === aiMessageId ? completedMessage : msg));
                              }

                              // Auto-generate & download PDF/Excel directly for general reports (Executive summary, Requisition history, etc.)
                              // ONLY individual requisition reports require manual confirmation box.
                              if (rawReports && rawReports.length > 0 && !isPending && currentUser?.role === 'admin') {
                                rawReports.forEach((rep, rIdx) => {
                                  setTimeout(() => {
                                    handleDownloadReport(rep, aiMessageId + rIdx, rep.format === 'excel');
                                  }, 200);
                                });
                              }
                          } else if (data.type === 'error') {
                              serverError = new Error(data.message);
                          }
                      } catch (e) {
                          // JSON parsing error on incomplete chunk
                      }
                      if (serverError) throw serverError;
                  }
              }
          }
      }
    } catch (err: any) {
      // If client aborted or stopped intentionally, keep whatever text was generated without showing an error
      if (abortController.signal.aborted || err?.name === 'AbortError' || (err?.message && (err.message.includes('aborted') || err.message.includes('SafetyTimeout')))) {
        if (textBuffer && textBuffer.trim().length > 0) {
          return;
        }
      }
      // If the model already sent response text to the user, preserve it rather than replacing with an error message
      if (textBuffer && textBuffer.trim().length > 0) {
        console.warn('Stream finished with notice, preserved generated content:', err);
        return;
      }
      let errorText = 'ขออภัยครับ เกิดข้อผิดพลาดในการดึงข้อมูลจาก AI กรุณาลองใหม่อีกครั้ง';
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        errorText = '📡 ขณะนี้ระบบขาดการเชื่อมต่ออินเทอร์เน็ต (Offline) กรุณาตรวจสอบการเชื่อมต่อ Wi-Fi หรือ Cellular แล้วลองส่งใหม่อีกครั้งครับ';
      } else if (err.message === 'QUOTA_EXCEEDED') {
        errorText = 'ขณะนี้มีผู้ใช้งาน AI จำนวนมากจนเกินโควต้าที่กำหนดไว้ กรุณารอสักครู่ (ประมาณ 1 นาที) แล้วลองส่งคำสั่งใหม่อีกครั้งครับ';
      } else if (err.message && (err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('high demand'))) {
        errorText = 'ขณะนี้ระบบ AI ให้บริการหนาแน่นชั่วคราว กรุณากดลองส่งคำถามใหม่อีกครั้งได้เลยครับ';
      }
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: errorText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory(prev => {
        const filtered = prev.filter(msg => msg.id !== aiMessageId);
        return [...filtered, errorMessage];
      });
    } finally {
      clearTimeout(safetyTimeout);
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      setIsProcessing(false);
    }
  };

  // Scroll to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isListening, transcript]);

  // Handle user confirming a DB action (Stock in / Stock out / update)
  const handleConfirmDbAction = useCallback(async (messageId: string, action: DbActionPayload) => {
    if (!action) return;

    if ((action.action === 'update_stock' || (action.action as any) === 'edit_item') && currentUser?.role !== 'admin') {
      alert('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขสต็อกหรือชื่ออะไหล่ได้');
      return;
    }

    if (action.action === 'requisition' || action.action === 'stock_in') {
      const isAllowed = await verifyLocation();
      if (!isAllowed) return;
    }

    // 1. Execute DB Action to Firestore / state (Suppress redundant chime/TTS when in Live Speech)
    if (onExecuteDbAction) {
      onExecuteDbAction({ ...action, skipVoice: isLiveConnected });
    }

    // 2. Mark as confirmed in chat history
    setChatHistory(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return {
          ...msg,
          isPendingConfirmation: false,
          isCancelled: false
        };
      }
      return msg;
    }));

    // 3. Audio / Speech Feedback
    if (isLiveConnected) {
      // When in Live Speech, Live Speech Gemini AI speaks the confirmation exclusively (no synthetic chime/TTS)
      const actionName = action.action === 'stock_in' ? 'รับเข้าสินค้า' : 'เบิกสินค้า';
      const itemName = action.item?.name || action.record?.itemName || 'สินค้า';
      const itemQty = action.record?.qty || 1;
      const itemUnit = action.item?.unit || action.record?.unit || 'หน่วย';
      sendMessage(`บันทึกการทำรายการ${actionName} ${itemName} จำนวน ${itemQty} ${itemUnit} เรียบร้อยแล้ว แจ้งผลยืนยันด้วยเสียงสั้นๆ`);
    } else {
      // For typed / text chat requisition, speak using browser Thai SpeechSynthesis
      const textToSpeak = action.action === 'stock_in' 
        ? 'ยืนยันรับเข้าสินค้าเรียบร้อยแล้วค่ะ'
        : action.action === 'requisition'
        ? 'ยืนยันการเบิกสินค้าเรียบร้อยแล้วค่ะ'
        : 'ยืนยันเรียบร้อยแล้วค่ะ';
      playSuccessSoundAndSpeak(textToSpeak);
    }
  }, [onExecuteDbAction, setChatHistory, isLiveConnected, sendMessage, verifyLocation, currentUser]);

  // Handle user cancelling a DB action
  const handleCancelDbAction = useCallback((messageId: string) => {
    setChatHistory(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return {
          ...msg,
          isPendingConfirmation: false,
          isCancelled: true
        };
      }
      return msg;
    }));

    if (isLiveConnected) {
      // If active in Live Speech, inform Live Speech AI to respond
      sendMessage('ผู้ใช้กดยกเลิกรายการแล้ว กรุณาแจ้งรับทราบการยกเลิกด้วยเสียงสั้นๆ');
    } else {
      // For typed chat, play TTS sound
      playSuccessSoundAndSpeak('ยกเลิกรายการแล้วค่ะ');
    }
  }, [setChatHistory, isLiveConnected, sendMessage]);

  // Handle user confirming a Report Generation (PDF / Excel)
  const handleConfirmReport = useCallback(async (messageId: string, report: ReportAction, idx: number = 0) => {
    if (!report) return;

    if (currentUser?.role !== 'admin') {
      alert('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถออกรายงาน PDF ได้');
      return;
    }

    try {
      const isExcel = report.format === 'excel';
      await handleDownloadReport(report, messageId + idx, isExcel);

      setChatHistory(prev => prev.map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            isPendingConfirmation: false,
            isCancelled: false,
            text: `✅ ยืนยันออกรายงาน "${report.title}" (${isExcel ? 'EXCEL' : 'PDF'}) สำเร็จและดาวน์โหลดเรียบร้อยแล้ว`
          };
        }
        return msg;
      }));

      const msgSuccess = `ออกรายงาน ${report.title} เรียบร้อยแล้วค่ะ`;
      if (isLiveConnected) {
        sendMessage(`ผู้ใช้กดยืนยันออกรายงาน "${report.title}" แล้ว ระบบดาวน์โหลดเสร็จสิ้น กรุณาแจ้งผลตอบรับด้วยเสียงสั้นๆ`);
      } else {
        playSuccessSoundAndSpeak(msgSuccess);
      }
    } catch (err) {
      console.error('Error generating confirmed report:', err);
      alert('เกิดข้อผิดพลาดในการสร้างเอกสารรายงาน กรุณาลองใหม่อีกครั้ง');
    }
  }, [currentUser, handleDownloadReport, setChatHistory, isLiveConnected, sendMessage]);

  // Handle user cancelling a Report Generation
  const handleCancelReport = useCallback((messageId: string, reportTitle?: string) => {
    setChatHistory(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return {
          ...msg,
          isPendingConfirmation: false,
          isCancelled: true,
          text: `❌ ยกเลิกการออกรายงาน "${reportTitle || 'รายงาน'}" แล้ว`
        };
      }
      return msg;
    }));

    if (isLiveConnected) {
      sendMessage('ผู้ใช้กดยกเลิกการออกรายงานแล้ว กรุณาแจ้งรับทราบการยกเลิกด้วยเสียงสั้นๆ');
    } else {
      playSuccessSoundAndSpeak('ยกเลิกการออกรายงานแล้วค่ะ');
    }
  }, [setChatHistory, isLiveConnected, sendMessage]);

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden bg-transparent transition-colors duration-200">
      {/* Top Bar */}
      <div className="eng-header px-3.5 py-2.5 shrink-0 z-10">
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-sky-400 flex items-center justify-center text-white shadow-sm shrink-0 ring-2 ring-orange-400/70">
              <Sparkles className="w-3 h-3" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="font-bold text-slate-800 dark:text-slate-100 text-sm sm:text-base leading-tight">AI ผู้ช่วยคลังสินค้า</h2>
              </div>
              <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 leading-tight">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                {isAdmin 
                  ? 'โหมด Admin: สั่งเบิก/รับเข้า/แก้ไขสต็อก/ออกรายงาน PDF' 
                  : 'โหมด Staff: สั่งเบิก/รับเข้าสินค้า/สอบถามสต็อก'}
              </span>
            </div>
          </div>

          {/* Reset Chat */}
          {chatHistory.length > 0 && (
            <button
              onClick={() => setChatHistory([])}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
              title="ล้างข้อความ"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="text-[11px]">ล้างแชท</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages List Area (Scrolls internally while bottom controls remain locked) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-4">
        <div className="max-w-4xl mx-auto w-full space-y-2.5">
        {chatHistory.length === 0 && (
          <div className="text-center py-2 sm:py-3 px-2">
            <div className="w-full max-w-[240px] h-20 mx-auto mb-2 flex items-center justify-center overflow-hidden rounded-xl">
              <EngLogo alt="ENG Smart Store" className="object-contain max-h-20" />
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base sm:text-lg mb-0.5">ENG AI ผู้ช่วยคลังสินค้า</h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-3 max-w-xs mx-auto leading-relaxed">
              {currentUser?.nickname ? `สวัสดีคุณ${currentUser.nickname} ✨ ` : ''}แตะไมค์พูดสั่ง หรือพิมพ์คำสั่งด้านล่างได้ทันที
            </p>

            {/* Quick Prompts */}
            <div className="space-y-1.5 max-w-sm mx-auto text-left">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider block px-1">
                ตัวอย่างคำสั่งที่ AI ดำเนินการได้:
              </span>
              {suggestedPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => sendQuery(prompt.replace(/^[^\s]+\s/, ''))}
                  className="w-full text-left bg-white dark:bg-[#101826] hover:bg-blue-50/70 dark:hover:bg-white/5 border border-slate-200/80 dark:border-white/10 hover:border-blue-400 rounded-2xl p-3 text-sm text-slate-700 dark:text-slate-200 font-medium transition-all shadow-sm flex items-center justify-between group active:scale-[0.99] cursor-pointer min-h-11"
                >
                  <span className="truncate pr-2">{prompt}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}

        {chatHistory.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[96%] sm:max-w-[86%] rounded-2xl p-3 shadow-xs text-base sm:text-lg leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none'
              }`}
            >
              {/* Message Header */}
              <div className="flex items-center gap-1.5 mb-1 opacity-75 text-xs">
                {msg.role === 'user' ? (
                  <>
                    <User className="w-3.5 h-3.5" />
                    <span>คุณ</span>
                  </>
                ) : (
                  <>
                    {msg.source === 'live' ? (
                      <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                        <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                        AI Live Speech
                      </span>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span className="font-semibold text-blue-600 dark:text-blue-400">AI Assistant</span>
                      </>
                    )}
                  </>
                )}
                <span>• {msg.timestamp}</span>
              </div>

              {/* Text content */}
              <div className="font-sans text-base sm:text-lg leading-relaxed">
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                ) : (
                  <div className="prose prose-slate dark:prose-invert max-w-none text-base sm:text-lg leading-relaxed space-y-2.5 prose-headings:font-bold prose-h3:text-base sm:prose-h3:text-lg prose-h3:mt-3 prose-h3:mb-1.5 prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2.5 prose-ul:space-y-1.5 prose-ol:my-2.5 prose-ol:space-y-1.5 prose-li:my-1 prose-strong:font-extrabold prose-strong:text-slate-900 dark:prose-strong:text-white prose-code:text-white prose-code:bg-slate-950 dark:prose-code:bg-black prose-code:border prose-code:border-slate-800 prose-code:px-2 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                )}
              </div>

              {/* Database Action Confirmation Card */}
              {msg.dbAction && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                  <div className={`p-3 sm:p-3.5 rounded-xl border shadow-xs transition-all ${
                    msg.isCancelled
                      ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 opacity-80'
                      : msg.isPendingConfirmation
                      ? 'border-amber-300 dark:border-amber-600 bg-gradient-to-b from-amber-50/60 to-white dark:from-amber-950/20 dark:to-slate-900 ring-2 ring-amber-400/20'
                      : msg.dbAction.action === 'stock_in'
                      ? 'border-emerald-200 dark:border-emerald-800/70 bg-white dark:bg-slate-900'
                      : msg.dbAction.action === 'requisition'
                      ? 'border-blue-200 dark:border-blue-800/70 bg-white dark:bg-slate-900'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 mt-0.5 shadow-xs ${
                          msg.isCancelled
                            ? 'bg-slate-400 dark:bg-slate-600'
                            : msg.isPendingConfirmation
                            ? 'bg-amber-500 animate-pulse'
                            : msg.dbAction.action === 'stock_in'
                            ? 'bg-emerald-500'
                            : 'bg-blue-600'
                        }`}>
                          {msg.isCancelled ? (
                            <XCircle className="w-5 h-5" />
                          ) : msg.isPendingConfirmation ? (
                            <Clock className="w-5 h-5" />
                          ) : msg.dbAction.action === 'stock_in' ? (
                            <ArrowDownRight className="w-5 h-5" />
                          ) : (
                            <ArrowUpRight className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-[17px] text-slate-900 dark:text-slate-100 leading-tight">
                            {msg.isCancelled ? (
                              <>
                                <span className="text-red-500">❌</span>
                                <span>ยกเลิกรายการแล้ว</span>
                              </>
                            ) : msg.isPendingConfirmation ? (
                              <>
                                <span className="text-amber-500">⏳</span>
                                <span>รอการยืนยัน: {msg.dbAction.action === 'stock_in' ? 'รับเข้าสินค้า (Stock In)' : 'เบิกสินค้า (Stock Out)'}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-emerald-500">✅</span>
                                <span>{msg.dbAction.action === 'stock_in' ? 'บันทึกรับเข้าสินค้า (Stock In) สำเร็จ' : 'บันทึกการเบิกสินค้า (Stock Out) สำเร็จ'}</span>
                              </>
                            )}
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 block">
                            {msg.isCancelled
                              ? 'ไม่มีการเปลี่ยนแปลงสต็อกสินค้า'
                              : msg.isPendingConfirmation
                              ? 'กรุณาตรวจสอบข้อมูลและกดปุ่มยืนยันด้านล่าง'
                              : 'อัปเดตฐานข้อมูลคลังสินค้าเรียบร้อยแล้ว'}
                          </span>
                        </div>
                      </div>

                      {msg.dbAction.record && (
                        <div className="font-mono text-sm font-semibold bg-slate-100 dark:bg-black px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white shadow-xs">
                          {msg.dbAction.record.id}
                        </div>
                      )}
                    </div>

                    {/* Content Details */}
                    {msg.dbAction.item && (
                      <div className="space-y-3 mt-1 bg-slate-50/70 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                        {/* Item Name & ID */}
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-[17px] text-slate-800 dark:text-slate-100">
                              {msg.dbAction.item.name}
                            </div>
                            <div className="text-sm text-slate-400 dark:text-slate-500 mt-0.5">
                              {msg.dbAction.item.category}
                            </div>
                          </div>
                          <div className="font-mono text-xs font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-black px-2 py-0.5 rounded border border-slate-300 dark:border-slate-800 text-right shadow-2xs">
                            {msg.dbAction.item.id}
                          </div>
                        </div>

                        {/* Stock Quantity */}
                        <div className="flex justify-between items-center py-2 border-y border-slate-200/60 dark:border-slate-700/60 border-dashed">
                          <span className="text-slate-500 dark:text-slate-400 text-sm">
                            {msg.isPendingConfirmation ? 'จำนวนที่จะเปลี่ยนแปลง:' : 'จำนวนสต็อกคงเหลือ:'}
                          </span>
                          <div className="flex items-center gap-2 text-[15px]">
                            <span className="text-slate-400 font-semibold line-through decoration-slate-300">
                              {msg.dbAction.previousQty}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                            <span className={`font-bold ${msg.dbAction.action === 'stock_in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
                              {msg.dbAction.newQty}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300 font-medium">
                              {msg.dbAction.item.unit}
                            </span>
                          </div>
                        </div>

                        {/* Record Details */}
                        {msg.dbAction.record && (
                          <div className="space-y-2.5">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 dark:text-slate-400 text-sm">ผู้ทำรายการ:</span>
                              <span className="text-slate-800 dark:text-slate-200 text-sm font-medium">
                                {msg.dbAction.record.requestedBy}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 dark:text-slate-400 text-sm">งาน/สถานที่นำไปใช้:</span>
                              <span className="text-slate-700 dark:text-slate-300 text-sm bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                {msg.dbAction.record.purpose || (msg.dbAction.action === 'stock_in' ? 'รับเข้าสต็อก' : 'เบิกไปใช้งาน')}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 dark:text-slate-400 text-sm">เวลา:</span>
                              <span className="text-slate-700 dark:text-slate-300 text-sm">
                                {msg.dbAction.record.timestamp || formatRecordTimestamp(new Date().toISOString(), new Date().toISOString())}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons: Pending Confirmation vs Confirmed vs Cancelled */}
                        {msg.isPendingConfirmation ? (
                          <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-2">
                            <button
                              onClick={() => handleConfirmDbAction(msg.id, msg.dbAction!)}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white py-3 px-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                              <span>กดยืนยันรายการ</span>
                            </button>
                            <button
                              onClick={() => handleCancelDbAction(msg.id)}
                              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-3 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                              <span>ยกเลิก</span>
                            </button>
                          </div>
                        ) : !msg.isCancelled ? (
                          <div className="flex gap-2 mt-4 pt-2">
                            <button
                              onClick={() => onOpenHistory && onOpenHistory()}
                              className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <ExternalLink className="w-4 h-4" />
                              ดูในหน้าประวัติ
                            </button>
                            <button
                              onClick={() => onSelectItem(msg.dbAction!.item!)}
                              className="flex-1 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center cursor-pointer shadow-sm"
                            >
                              ดูข้อมูลสินค้านี้
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Item Cards List (Shown when inquiring stock or checking parts) */}
              {!msg.dbAction && msg.suggestedItems && msg.suggestedItems.length > 0 && (
                <div className="mt-4 pt-3.5 border-t border-slate-200/90 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold px-0.5">
                    <span className="flex items-center gap-1.5 text-slate-800 dark:text-slate-100 font-bold">
                      <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      การ์ดข้อมูลอะไหล่/สินค้า ({msg.suggestedItems.length} รายการ):
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">แตะการ์ดเพื่อดูหรือทำรายการ</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {msg.suggestedItems.map((rawItem) => {
                      const item = items.find(i => i.id === rawItem.id) || rawItem;
                      const qty = Number(item.qty) || 0;
                      const minStock = Number(item.minStock) || 1;
                      const isOut = qty <= 0 || item.status === 'out';
                      const isLow = !isOut && (qty <= minStock || item.status === 'low');

                      let outOfStockInfo = null;
                      if (isOut) {
                        const itemReqs = requisitions.filter(r => r.itemId === item.id && (r.type === "out" || !r.type));
                        itemReqs.sort((a, b) => new Date(b.isoDate || b.timestamp).getTime() - new Date(a.isoDate || a.timestamp).getTime());
                        const lastReq = itemReqs[0];
                        if (lastReq) {
                          const lastReqDate = new Date(lastReq.isoDate || lastReq.timestamp);
                          const daysOut = Math.floor((new Date().getTime() - lastReqDate.getTime()) / (1000 * 60 * 60 * 24));
                          outOfStockInfo = `หมดสต็อกตั้งแต่วันที่ ${lastReq.timestamp} (เมื่อ ${daysOut} วันก่อน)`;
                        }
                      }

                      return (
                        <div 
                          key={item.id}
                          className={`rounded-xl border p-2.5 sm:p-3 shadow-xs transition-all flex flex-col justify-between ${
                            isOut
                              ? 'bg-gradient-to-b from-red-50/80 to-white dark:from-red-950/30 dark:to-slate-900 border-red-200 dark:border-red-900/60'
                              : isLow
                              ? 'bg-gradient-to-b from-amber-50/80 to-white dark:from-amber-950/30 dark:to-slate-900 border-amber-200 dark:border-amber-900/60'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'
                          }`}
                        >
                          {/* Item Details */}
                          <div>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 leading-snug">
                                  {item.name}
                                </h4>
                                <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-black border border-slate-300 dark:border-slate-800 px-2 py-0.5 rounded shadow-2xs shrink-0">
                                  {item.id}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 rounded font-medium">
                                  {item.category || 'ทั่วไป'}
                                </span>
                                {item.location && (
                                  <div className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                    <span>{item.location}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Stock Status Badge */}
                            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">สถานะคงเหลือ:</span>
                              <div>
                                {isOut ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                    หมดสต็อก (0 {item.unit})
                                  </span>
                                ) : isLow ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    ใกล้หมด ({qty}/{minStock} {item.unit})
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    คงเหลือ {qty} {item.unit}
                                  </span>
                                )}
                              </div>
                            </div>
                            {outOfStockInfo && (
                              <div className="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 rounded-lg text-right border border-red-100 dark:border-red-900/50 flex items-center justify-end gap-1.5 font-medium shadow-sm">
                                <Clock className="w-3 h-3" />
                                {outOfStockInfo}
                              </div>
                            )}
                          </div>
                          </div>

                          {/* Quick Action Buttons */}
                          <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                              type="button"
                              onClick={() => onSelectItem(item)}
                              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 px-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                              title="เปิดดูรายละเอียดอะไหล่"
                            >
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">ดูข้อมูล</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                window.open(`https://www.google.com/search?q=${encodeURIComponent(item.name)}`, '_blank', 'noopener,noreferrer');
                              }}
                              className="bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 py-1.5 px-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                              title={`ค้นหา "${item.name}" ใน Google`}
                            >
                              <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                              <span className="truncate">ถาม Google</span>
                            </button>

                            {isOut ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isLiveConnected) {
                                    sendMessage(`ต้องการรับเข้าสินค้า ${item.name} รหัส ${item.id} จำนวน 10 ${item.unit}`);
                                  } else {
                                    sendQuery(`ขอรับเข้าสินค้า ${item.name} จำนวน 10 ${item.unit}`);
                                  }
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 px-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs"
                                title="สั่งรับเข้าสต็อก"
                              >
                                <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">สั่งรับเข้า</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isLiveConnected) {
                                    sendMessage(`ต้องการเบิก ${item.name} รหัส ${item.id} จำนวน 1 ${item.unit}`);
                                  } else {
                                    sendQuery(`ขอเบิก ${item.name} จำนวน 1 ${item.unit}`);
                                  }
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white py-1.5 px-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs"
                                title="เบิกสินค้านี้"
                              >
                                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">เบิกทันที</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Interactive PDF / Excel Generation Confirmation & Download Card */}
              {(msg.fileReports || (msg.fileReport ? [msg.fileReport] : [])).map((report, idx) => {
                const isExcel = report.format === 'excel';
                const isIndividualReport = report.type === 'individual_requisitions' || Boolean(report.userFilter);
                const isPending = msg.isPendingConfirmation && isIndividualReport && !msg.isCancelled;
                const isCancelled = msg.isCancelled;
                const isGenerating = generatingPdfId === (msg.id + idx);
                const requesterName = report.requestedBy || currentUser?.nickname || currentUser?.name || 'ผู้ใช้งาน';

                return (
                  <div key={idx} className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className={`rounded-2xl border p-3.5 sm:p-4 shadow-sm transition-all ${
                      isCancelled
                        ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 opacity-80'
                        : isPending
                        ? 'border-amber-300 dark:border-amber-600 bg-gradient-to-b from-amber-50/80 via-white to-amber-50/30 dark:from-amber-950/25 dark:via-slate-900 dark:to-slate-900 ring-2 ring-amber-400/25'
                        : isExcel
                        ? 'bg-gradient-to-r from-green-50/90 to-emerald-50/70 dark:from-green-950/40 dark:to-emerald-950/30 border-green-300 dark:border-green-800'
                        : 'bg-gradient-to-r from-red-50/90 to-orange-50/70 dark:from-red-950/40 dark:to-orange-950/30 border-red-300 dark:border-red-800'
                    }`}>
                      {/* Card Header */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl text-white flex items-center justify-center shadow-xs shrink-0 mt-0.5 ${
                            isCancelled
                              ? 'bg-slate-400 dark:bg-slate-600'
                              : isPending
                              ? 'bg-amber-500 animate-pulse'
                              : isExcel
                              ? 'bg-green-600'
                              : 'bg-red-600'
                          }`}>
                            {isCancelled ? (
                              <XCircle className="w-5 h-5" />
                            ) : isPending ? (
                              <Clock className="w-5 h-5" />
                            ) : (
                              <FileText className="w-5 h-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-slate-100 text-base sm:text-lg leading-tight">
                                {report.title}
                              </span>
                              <span className={`text-[11px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                isExcel
                                  ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-800'
                                  : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800'
                              }`}>
                                {isExcel ? 'EXCEL' : 'PDF'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {isCancelled
                                ? 'ยกเลิกคำสั่งออกรายงานแล้ว (ไม่มีการสร้างไฟล์)'
                                : isPending
                                ? '⏳ กรุณาตรวจสอบชื่อพนักงานและเงื่อนไขด้านล่างให้ตรงกัน ก่อนกดยืนยัน'
                                : '✅ ออกเอกสารรายงานพร้อมเปิด/ดาวน์โหลดเรียบร้อยแล้ว'}
                            </p>
                          </div>
                        </div>

                        {/* Top Right Status Badge */}
                        <div className="shrink-0">
                          {isCancelled ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              <X className="w-3.5 h-3.5" /> ยกเลิกแล้ว
                            </span>
                          ) : isPending ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/40 animate-pulse">
                              <Clock className="w-3.5 h-3.5" /> รอยืนยัน
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/40">
                              <CheckCircle2 className="w-3.5 h-3.5" /> สำเร็จ
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Requester & Report Details Inspection Box */}
                      <div className="mb-3 p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800/80 text-xs sm:text-sm space-y-2 shadow-2xs">
                        {/* Commanded by User Name */}
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium shrink-0">
                            <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <span>ผู้สั่งออกรายงาน:</span>
                          </span>
                          <div className="flex items-center gap-1.5 text-right font-bold text-slate-900 dark:text-white">
                            <span className="px-2.5 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800 font-bold">
                              {requesterName.startsWith('คุณ') ? requesterName : `คุณ${requesterName}`}
                            </span>
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 border border-amber-400/30 tracking-wider">
                              ADMIN
                            </span>
                          </div>
                        </div>

                        {/* Target System Employee in Report (Strict System Employee Verification) */}
                        {(report.type === 'individual_requisitions' || report.userFilter) && (() => {
                          const matchedEmp = findEmployeeInSystem(report.userFilter || report.employeeName || report.employeeId);
                          
                          if (matchedEmp) {
                            return (
                              <div className="p-3 rounded-xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold flex items-center gap-1.5 text-blue-950 dark:text-blue-100">
                                    <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    <span>พนักงานเป้าหมายในระบบ Store FL.6:</span>
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-2xs">
                                    <CheckCircle2 className="w-3 h-3" /> ยืนยันพนักงานในระบบแล้ว (Verified)
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-blue-200/60 dark:border-blue-800/60">
                                  <div className="min-w-0">
                                    <div className="font-black text-slate-900 dark:text-white text-sm sm:text-base leading-tight">
                                      คุณ{matchedEmp.name}
                                    </div>
                                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                      ชื่อเล่น: <strong className="text-blue-700 dark:text-blue-300">{matchedEmp.nickname}</strong> ({matchedEmp.thaiNickname}) • {matchedEmp.thaiName}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black bg-blue-600 text-white shadow-2xs">
                                      รหัส: {matchedEmp.id}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // If an individual report was requested but no valid employee was matched
                          return (
                            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 space-y-2 text-amber-900 dark:text-amber-200">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-200">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>ไม่พบข้อมูลหรือรหัสพนักงาน "{report.userFilter || 'ไม่ระบุ'}" ในระบบ Store FL.6</span>
                              </div>
                              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                                การออกรายงานรายบุคคลต้องอ้างอิงพนักงานจริงในระบบเท่านั้น โปรดเลือกรหัสหรือรายชื่อพนักงานจากรายการด้านล่าง:
                              </p>
                              <select
                                onChange={(e) => {
                                  const selectedId = e.target.value;
                                  const emp = SYSTEM_EMPLOYEES.find(u => u.id === selectedId);
                                  if (emp) {
                                    setChatHistory(prev => prev.map(m => {
                                      if (m.id === msg.id) {
                                        const updatedReports = (m.fileReports || []).map((r, rIdx) => {
                                          if (rIdx === idx) {
                                            return {
                                              ...r,
                                              userFilter: emp.name,
                                              employeeId: emp.id,
                                              employeeName: emp.name,
                                              employeeNickname: emp.nickname,
                                              employeeThaiName: emp.thaiName,
                                              isEmployeeVerified: true,
                                              title: `รายงานประวัติการเบิก-รับสินค้ารายบุคคล: ${emp.name} (${emp.nickname}) [รหัส: ${emp.id}]`
                                            };
                                          }
                                          return r;
                                        });
                                        return { ...m, fileReports: updatedReports };
                                      }
                                      return m;
                                    }));
                                  }
                                }}
                                className="w-full text-xs p-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-slate-800 dark:text-slate-100 font-medium outline-none cursor-pointer"
                                defaultValue=""
                              >
                                <option value="" disabled>-- แตะเพื่อเลือกพนักงานในระบบ (มีทั้งหมด 32 ท่าน) --</option>
                                {SYSTEM_EMPLOYEES.map(emp => (
                                  <option key={emp.id} value={emp.id}>
                                    รหัส {emp.id}: คุณ{emp.name} ({emp.nickname} / {emp.thaiName})
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })()}

                        {/* Category filter if specified */}
                        {report.categoryFilter && report.categoryFilter !== 'all' && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-purple-500" />
                              <span>หมวดหมู่ที่เลือก:</span>
                            </span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{report.categoryFilter}</span>
                          </div>
                        )}

                        {/* Order status filter if specified */}
                        {report.orderStatusFilter && report.orderStatusFilter !== 'all' && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500 dark:text-slate-400">สถานะคำสั่งซื้อ:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{report.orderStatusFilter}</span>
                          </div>
                        )}

                        {/* Date Range if specified */}
                        {(report.startDate || report.endDate) && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-blue-500" />
                              <span>ช่วงวันที่และเวลา:</span>
                            </span>
                            <span className="font-medium text-slate-800 dark:text-slate-200 text-right">
                              {report.startDate || 'ย้อนหลัง'} ถึง {report.endDate || 'ปัจจุบัน'}
                              {report.startTime && ` (${report.startTime} - ${report.endTime || '23:59'} น.)`}
                            </span>
                          </div>
                        )}

                        {/* Scope summary */}
                        <div className="flex items-center justify-between gap-2 text-slate-500 dark:text-slate-400 text-xs pt-1 border-t border-slate-200/40 dark:border-slate-800/40">
                          <span>รูปแบบเอกสาร:</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            ขนาดมาตรฐาน A4 พร้อมตรา ENG SMART STORE
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons: Pending Confirmation vs Confirmed vs Cancelled */}
                      {isPending ? (() => {
                        const targetEmp = (report.type === 'individual_requisitions' || report.userFilter)
                          ? findEmployeeInSystem(report.userFilter || report.employeeName || report.employeeId)
                          : null;
                        const isIndividualInvalid = (report.type === 'individual_requisitions') && !targetEmp;

                        return (
                          <div className="flex flex-col sm:flex-row gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmReport(msg.id, report, idx)}
                              disabled={isGenerating || isIndividualInvalid}
                              className={`flex-1 active:scale-[0.98] text-white py-3 px-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 ${
                                isIndividualInvalid 
                                  ? 'bg-slate-400 dark:bg-slate-700 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-600/20'
                              }`}
                            >
                              {isGenerating ? (
                                <>
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  <span>กำลังสร้างเอกสารรายงาน...</span>
                                </>
                              ) : isIndividualInvalid ? (
                                <>
                                  <AlertCircle className="w-5 h-5 text-amber-300" />
                                  <span>กรุณาเลือกพนักงานในระบบก่อนออกรายงาน</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-5 h-5" />
                                  <span>ยืนยันออกรายงาน {isExcel ? 'Excel' : 'PDF'}</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelReport(msg.id, report.title)}
                              disabled={isGenerating}
                              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-3 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <X className="w-4 h-4" />
                              <span>ยกเลิก</span>
                            </button>
                          </div>
                        );
                      })() : !isCancelled ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadReport(report, msg.id + idx, isExcel)}
                          disabled={isGenerating}
                          className={`w-full active:scale-[0.98] disabled:opacity-75 text-white py-3 px-4 rounded-xl text-base font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer ${
                            isExcel 
                              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-600/20' 
                              : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-red-600/20'
                          }`}
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              <span>กำลังจัดเตรียมและเปิดเอกสาร...</span>
                            </>
                          ) : (
                            <>
                              <FileDown className="w-5 h-5" />
                              <span>เปิด / ดาวน์โหลดรายงาน {isExcel ? 'EXCEL' : 'PDF'}</span>
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Live Speech User Hearing Indicator */}
        {isLiveConnected && (isUserSpeaking || liveUserSpokenText) && (
          <div className="flex flex-col items-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-none p-3 bg-emerald-600/90 text-white shadow-xs text-sm sm:text-base animate-pulse flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-200 shrink-0" />
              <div>
                <span className="text-[11px] block opacity-80 mb-0.5">AI กำลังได้ยินเสียงของคุณ:</span>
                <span className="font-medium">{liveUserSpokenText ? `"${liveUserSpokenText}"` : 'กำลังรับฟังคำสั่ง...'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Live Interim Transcript Bubble while Listening */}
        {isListening && transcript && (
          <div className="flex flex-col items-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-none p-3 bg-blue-500/80 text-white text-lg shadow-xs animate-pulse">
              <span className="text-xs block opacity-80 mb-0.5">กำลังฟังเสียง...</span>
              {transcript}
            </div>
          </div>
        )}

        {/* Thinking Indicator */}
        {isProcessing && !chatHistory.some(m => m.role === 'assistant' && m.text.length > 0 && m.id === chatHistory[chatHistory.length - 1]?.id) && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-none p-3 shadow-xs w-fit">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-sm sm:text-base">AI กำลังวิเคราะห์และตอบกลับ...</span>
            <button
              type="button"
              onClick={stopCurrentQuery}
              className="ml-2 px-2 py-0.5 text-xs font-semibold text-red-500 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors cursor-pointer"
            >
              ยกเลิก
            </button>
          </div>
        )}

        <div ref={chatBottomRef} />
        </div>
      </div>

      {/* Voice Control & Input Area (Permanently locked above bottom navigation bar) */}
      <div 
        style={{
          paddingBottom: 'max(108px, calc(env(safe-area-inset-bottom, 24px) + 90px))'
        }}
        className="px-3 pt-2 pb-1 bg-white/95 dark:bg-[#0c1220]/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-white/10 shrink-0 shadow-[0_-12px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_-12px_32px_rgba(0,0,0,0.45)] z-20"
      >
        <div className="max-w-4xl mx-auto w-full">
        {/* Live Chat Button & Voice Reactive Controls */}
        <div className="flex flex-col items-center justify-center mb-2">
          <div className="relative flex items-center justify-center">
            {/* Dynamic Soundwave Ripple Rings */}
            {isLiveConnected && (
              <>
                {/* Outer dynamic ring */}
                <div 
                  className={`absolute rounded-full transition-all duration-75 pointer-events-none ${
                    isAiSpeaking 
                      ? 'bg-blue-400/30 border border-blue-400/40' 
                      : 'bg-emerald-400/25 border border-emerald-400/40'
                  }`}
                  style={{
                    width: '68px',
                    height: '68px',
                    transform: `scale(${1.15 + (audioVolume * 0.85)})`,
                    opacity: 0.2 + (audioVolume * 0.7)
                  }}
                />

                {/* Mid dynamic ring */}
                <div 
                  className={`absolute rounded-full transition-all duration-75 pointer-events-none ${
                    isAiSpeaking 
                      ? 'bg-blue-500/35' 
                      : 'bg-emerald-500/30'
                  }`}
                  style={{
                    width: '60px',
                    height: '60px',
                    transform: `scale(${1.08 + (audioVolume * 0.5)})`,
                    opacity: 0.4 + (audioVolume * 0.6)
                  }}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => isLiveConnected ? stopLive() : startLive(currentUser?.name, currentUser?.role, items, requisitions, currentUser?.nickname)}
              disabled={isProcessing || isConnecting}
              style={{
                transform: isLiveConnected 
                  ? `scale(${1 + Math.min(0.24, audioVolume * 0.36)})` 
                  : undefined
              }}
              className={`relative z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-xl transition-transform duration-75 active:scale-95 cursor-pointer ${
                isLiveConnected
                  ? isAiSpeaking
                    ? 'bg-blue-600 text-white ring-4 ring-blue-200 dark:ring-blue-950 shadow-blue-500/40'
                    : 'bg-emerald-600 text-white ring-4 ring-emerald-200 dark:ring-emerald-950 shadow-emerald-500/40'
                  : isConnecting
                  ? 'bg-blue-600 text-white animate-pulse'
                  : 'bg-blue-600 text-white shadow-blue-500/30 hover:scale-105'
              }`}
            >
              {isConnecting ? (
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin" />
              ) : isLiveConnected ? (
                isAiSpeaking ? (
                  <Volume2 className="w-6 h-6 sm:w-8 sm:h-8 animate-bounce" />
                ) : (
                  <Mic className="w-6 h-6 sm:w-8 sm:h-8" />
                )
              ) : (
                <Headset className="w-6 h-6 sm:w-8 sm:h-8" />
              )}
            </button>
          </div>

          {/* Voice-reactive Equalizer Bars & Active Model Indicator (shown when connected) */}
          {isLiveConnected && (
            <div className="flex flex-col items-center gap-1 mt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-400/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {activeLiveModel.includes('3.8') ? 'Gemini 3.8 Live' : 'Gemini 3.1 Live (Fallback)'}
              </span>
              <div className="flex items-center gap-1 h-3 mt-0.5">
                {[0.5, 0.9, 1.2, 0.8, 0.6].map((multiplier, i) => (
                  <div 
                    key={i}
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isAiSpeaking 
                        ? 'bg-blue-500' 
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      height: `${Math.max(3, Math.min(16, (audioVolume * 18 * multiplier) + 3))}px`
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Voice Status Description */}
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5 text-center">
            {isConnecting ? (
              <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1 justify-center">
                <Loader2 className="w-3 h-3 animate-spin" />
                กำลังเชื่อมต่อ Live Speech...
              </span>
            ) : isLiveConnected ? (
              isAiSpeaking ? (
                <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1 justify-center">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                  🔊 AI กำลังตอบด้วยเสียง...
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 justify-center">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  🎙️ กำลังฟังเสียงของคุณ... (พูดโต้ตอบได้เลย)
                </span>
              )
            ) : (
              'แตะเพื่อเปิดโหมดคุยสดกับ AI แบบเรียลไทม์'
            )}
          </p>
        </div>

        {/* Text input bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleStopAndSend();
          }}
          className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus-within:border-blue-500 dark:focus-within:border-blue-500 rounded-xl p-1 shadow-2xs transition-colors"
        >
          {/* Normal Dictation Mic Button */}
          <button
            type="button"
            onClick={toggleListening}
            disabled={isProcessing}
            className={`w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-lg flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 border border-slate-300 dark:border-slate-650 ${
              isListening
                ? 'bg-red-500 text-white animate-pulse border-red-400'
                : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'
            }`}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isProcessing ? "AI กำลังตอบกลับ..." : "พิมพ์ หรือสั่งพิมพ์ด้วยเสียง..."}
            disabled={isProcessing}
            className="flex-1 bg-transparent px-2 py-1 text-sm sm:text-base text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 min-w-0"
          />
          {isProcessing ? (
            <button
              type="button"
              onClick={stopCurrentQuery}
              className="w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 border border-red-400"
              title="หยุดการตอบกลับ"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 border border-blue-500"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
        </div>
      </div>

      <GeoRestrictionModal
        state={geoModalState}
        onClose={closeGeoModal}
        onRetry={recheckLocation}
        isChecking={isCheckingGeo}
      />
    </div>
  );
};
