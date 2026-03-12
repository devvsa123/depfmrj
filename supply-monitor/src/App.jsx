import React, { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar, Brush, Area, PieChart, Pie, Cell, BarChart
} from 'recharts';
import {
  Upload, FileSpreadsheet, TrendingUp, CheckCircle2, Sparkles,
  Loader2, Activity, Target, Clock, AlertCircle, XCircle, Package,
  LayoutDashboard, Hourglass, AlertTriangle, ListFilter, X, Download, RefreshCw,
  Network, Database, ArrowRightLeft, Calendar, Info, Search
} from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';

const XLSX_SCRIPT_URL = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";
const WMS_URL = "https://spxj2yln4kauap03.public.blob.vercel-storage.com/planilha_estoque.xls";
const SINGRA_URL = "https://spxj2yln4kauap03.public.blob.vercel-storage.com/planilha_rms_unificada.csv";

// --- MAPEAMENTO PADRÃO DE CORES POR STATUS ---
const STATUS_COLOR_MAP = {
  'CONFERIDO': '#10b981',       // Esmeralda (Sucesso/Final de fluxo)
  'CONFERENCIA': '#8b5cf6',     // Violeta
  'EM CONFERENCIA': '#8b5cf6',  // Violeta
  'SEPARACAO': '#f59e0b',       // Âmbar
  'EM SEPARACAO': '#f59e0b',    // Âmbar
  'SEPARADO': '#f59e0b',        // Âmbar
  'PLANEJAMENTO': '#3b82f6',    // Azul
  'EM PLANEJAMENTO': '#3b82f6', // Azul
  'RESERVADO': '#6366f1',       // Índigo
  'EM ATENDIMENTO': '#06b6d4',  // Ciano
  'PENDENTE': '#94a3b8',        // Slate (Neutro)
  'N/A': '#cbd5e1'              // Cinza claro
};

const getStatusColor = (status) => {
  const normalized = String(status || "").toUpperCase().trim();
  return STATUS_COLOR_MAP[normalized] || '#94a3b8'; 
};

// --- UTILITÁRIOS DE CACHE (IndexedDB) ---
const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('SupplyMonitorDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cacheStore')) {
        db.createObjectStore('cacheStore');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveToCache = async (key, data) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cacheStore', 'readwrite');
      const store = tx.objectStore('cacheStore');
      store.put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Falha ao salvar no cache local:", err);
  }
};

const getFromCache = async (key) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cacheStore', 'readonly');
      const store = tx.objectStore('cacheStore');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Falha ao ler cache local:", err);
    return null;
  }
};

// --- COMPONENTE DE EXPLICAÇÃO (TOOLTIP) ---
const InfoButton = ({ title, description }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative inline-block ml-1">
      <button 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="p-1 hover:bg-slate-100 rounded-full transition-colors text-slate-300 hover:text-indigo-500"
      >
        <Info size={14} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 bg-slate-800 text-white text-xs rounded-2xl shadow-2xl z-[70] animate-in fade-in zoom-in duration-200">
            <p className="font-black uppercase tracking-widest mb-2 text-indigo-300 border-b border-slate-700 pb-1">{title}</p>
            <p className="font-medium leading-relaxed">{description}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800" />
          </div>
        </>
      )}
    </div>
  );
};

const App = () => {
  const [data, setData] = useState([]);
  const [singraData, setSingraData] = useState([]); 
  const [emailText, setEmailText] = useState("");
  const [extractedOrders, setExtractedOrders] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [libLoaded, setLibLoaded] = useState(false);
  
  const [lastSync, setLastSync] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeInterfaceView, setActiveInterfaceView] = useState("falhasInterface");
  const [selectedErrorFilter, setSelectedErrorFilter] = useState(null); 

  const [selectedBucket, setSelectedBucket] = useState(null);
  const [selectedPiSegment, setSelectedPiSegment] = useState(null); 

  // Correção de Inicialização: O estado default agora é `null` para assumir o tamanho completo dos dados
  const [visibleRange, setVisibleRange] = useState(null);
  
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");

  const [interfaceStartDate, setInterfaceStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); 
    return d.toISOString().split('T')[0];
  });
  const [interfaceEndDate, setInterfaceEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [backlogStartDate, setBacklogStartDate] = useState("");
  const [backlogEndDate, setBacklogEndDate] = useState("");

  const apiKey = "AIzaSyBxUWKDnpog0loQyd3tiFUguEgxwr9xh4k"; 

  useEffect(() => {
    if (window.XLSX) {
      setLibLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = XLSX_SCRIPT_URL;
    script.async = true;
    script.onload = () => setLibLoaded(true);
    script.onerror = () => setError("Erro ao carregar motor de Excel.");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (libLoaded && data.length === 0) {
      performSync(false);
    }
  }, [libLoaded]);

  useEffect(() => {
    if (!emailText || data.length === 0) {
      setExtractedOrders([]);
      return;
    }
    
    // Regex para buscar padrões como 12.345.678 ou 12345678
    const regex = /\b(\d{2}\.\d{3}\.\d{3}|\d{8})\b/g;
    const matches = emailText.match(regex) || [];
    
    // Remove duplicatas e tira os pontos para padronizar
    const uniqueCleanIds = [...new Set(matches.map(m => m.replace(/\./g, '')))];
    
    // Cria um mapa rápido do Singra
    const singraMap = {};
    singraData.forEach(item => {
      const p = String(item.ID || item.PEDIDO || item.RM || item.DOCUMENTO).replace(/^0+/, '').trim().toUpperCase();
      if (p) singraMap[p] = item;
    });

    // Cruza os IDs encontrados com o WMS e o SINGRA
    const results = uniqueCleanIds.map(id => {
      const idBusca = id.replace(/^0+/, '').toUpperCase();
      const wmsItem = data.find(d => String(d.PEDIDO || d.RM || "").trim().replace(/^0+/, '').toUpperCase() === idBusca);
      const singraItem = singraMap[idBusca];
      
      return {
        idOriginal: id,
        wmsStatus: wmsItem ? wmsItem.STATUS : "NÃO LOCALIZADO",
        singraStatus: singraItem ? (singraItem.SITUACAO || singraItem.STATUS) : "NÃO CONSTA",
        dataEntrada: wmsItem && wmsItem.DATA_ENTRADA ? safeGetISODate(wmsItem.DATA_ENTRADA) : null
      };
    });
    
    setExtractedOrders(results);
  }, [emailText, data, singraData]);

  const safeGetISODate = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'number') {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (brMatch) {
        return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
      }
    }
    const d = new Date(val);
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null;
  };

  const fetchSingraOnly = async () => {
    try {
      const res = await fetch(`${SINGRA_URL}?t=${Date.now()}`);
      if (!res.ok) return [];
      const text = await res.text();
      let json = [];
      
      if (text.includes(';') && !text.startsWith('PK')) {
        const lines = text.split('\n');
        const headers = lines[0].split(';').map(h => h.replace(/['"]/g, '').trim());
        json = lines.slice(1).filter(l => l.trim()).map(line => {
             const values = line.split(';').map(v => v.replace(/['"]/g, '').trim());
             const obj = {};
             headers.forEach((h, i) => obj[h] = values[i]);
             return obj;
        });
      } else {
        const arrayBuffer = new TextEncoder().encode(text);
        const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        json = window.XLSX.utils.sheet_to_json(ws);
      }

      return json.map(item => {
        const newItem = {};
        Object.keys(item).forEach(key => {
          const cleanKeyRaw = key.replace(/['"]/g, '');
          const normalizedKey = cleanKeyRaw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          newItem[normalizedKey] = item[key];
        });
        return newItem;
      });
    } catch (err) {
      console.error("Erro ao puxar Singra avulso", err);
      return [];
    }
  };

  const performSync = async (forceDownload = false) => {
    if (!libLoaded) return;
    setLoading(true);
    setError("");

    try {
      const wmsHead = await fetch(`${WMS_URL}?t=${Date.now()}`, { method: 'HEAD' }).catch(() => null);
      const singraHead = await fetch(`${SINGRA_URL}?t=${Date.now()}`, { method: 'HEAD' }).catch(() => null);

      const wmsMod = wmsHead ? wmsHead.headers.get('last-modified') : null;
      const singraMod = singraHead ? singraHead.headers.get('last-modified') : null;

      if (!forceDownload) {
        const cachedData = await getFromCache('supplyData');
        if (cachedData && cachedData.wmsMod === wmsMod && cachedData.singraMod === singraMod) {
          setData(cachedData.wmsData);
          setSingraData(cachedData.singraData);
          setLastSync(cachedData.lastSync);
          setFileName("Carregado Rápido (Cache)");
          setLoading(false);
          return;
        }
      }

      const wmsRes = await fetch(`${WMS_URL}?t=${Date.now()}`);
      if (!wmsRes.ok) throw new Error("Falha ao baixar WMS");
      const wmsBuffer = await wmsRes.arrayBuffer();
      const wmsWb = window.XLSX.read(wmsBuffer, { type: 'array', cellDates: true });
      const wmsJson = window.XLSX.utils.sheet_to_json(wmsWb.Sheets[wmsWb.SheetNames[0]]);
      
      if (wmsJson.length === 0) throw new Error("A planilha da nuvem está vazia.");

      const normalizedWms = wmsJson.map(item => {
        const newItem = {};
        Object.keys(item).forEach(key => {
          const cleanKeyRaw = key.replace(/['"]/g, '');
          const normalizedKey = cleanKeyRaw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          newItem[normalizedKey] = item[key];
        });
        return newItem;
      });

      const normalizedSingra = await fetchSingraOnly();
      
      // Calcula a data mais recente de modificação entre as planilhas do Vercel
      let actualLastUpdate = new Date();
      if (wmsMod || singraMod) {
        const d1 = wmsMod ? new Date(wmsMod).getTime() : 0;
        const d2 = singraMod ? new Date(singraMod).getTime() : 0;
        actualLastUpdate = new Date(Math.max(d1, d2));
      }
      const lastSyncTime = actualLastUpdate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      
      setData(normalizedWms);
      setSingraData(normalizedSingra);
      setLastSync(lastSyncTime);
      setFileName("Sincronizado na Nuvem ☁️");

      await saveToCache('supplyData', {
        wmsMod, 
        singraMod,
        wmsData: normalizedWms,
        singraData: normalizedSingra,
        lastSync: lastSyncTime
      });

    } catch (err) {
      console.error(err);
      setError("Falha na sincronização automatizada.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !libLoaded) return;

    setLoading(true);
    setError("");
    setAiAnalysis("");
    setFileName(file.name);
    // Usa a data real em que o arquivo foi modificado no computador
    setLastSync(new Date(file.lastModified).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));

    const singra = await fetchSingraOnly();
    setSingraData(singra);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = window.XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const jsonData = window.XLSX.utils.sheet_to_json(ws);

        if (jsonData.length === 0) throw new Error("A planilha está vazia.");

        const normalizedData = jsonData.map(item => {
          const newItem = {};
          Object.keys(item).forEach(key => {
            const cleanKeyRaw = key.replace(/['"]/g, '');
            const normalizedKey = cleanKeyRaw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            newItem[normalizedKey] = item[key];
          });
          return newItem;
        });
        setData(normalizedData);
      } catch (err) {
        setError("Erro ao processar o arquivo.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDownloadExcel = (dataSet, sheetName) => {
    if (!dataSet || dataSet.length === 0) return;
    const exportData = dataSet.map(item => ({
      PI: item.PI || "-",
      PEDIDO: item.PEDIDO || item.RM || "S/N",
      STATUS_WMS: item.STATUS || "-",
      STATUS_SINGRA: item.singraStatus || "-", 
      DATA_ENTRADA: item.entryDateIso || (item.DATA_ENTRADA ? safeGetISODate(item.DATA_ENTRADA) : "-"),
      ...(item.daysOpen !== undefined ? { DIAS_EM_ABERTO: item.daysOpen } : {})
    }));

    const ws = window.XLSX.utils.json_to_sheet(exportData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Dados");
    window.XLSX.writeFile(wb, `${sheetName}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const interfaceAnalysis = useMemo(() => {
    if (data.length === 0) return null;

    const singraMap = {};
    singraData.forEach(item => {
      const pedidoKey = item.ID || item.PEDIDO || item.RM || item.DOCUMENTO;
      if (pedidoKey) {
        const safeKey = String(pedidoKey).replace(/^0+/, '').trim().toUpperCase();
        singraMap[safeKey] = item;
      }
    });

    // NOVO: Criamos um "mapa de memória" do WMS para saber quem já foi checado
    const wmsMap = new Set();

    const results = {
      aguardandoRetirada: [],
      aguardandoArrecadacao: [],
      arrecadadoOms: [],
      falhasInterface: []
    };

    const normalizeString = (str) => String(str || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    const startFilter = new Date(interfaceStartDate);
    startFilter.setHours(0,0,0,0);
    const endFilter = new Date(interfaceEndDate);
    endFilter.setHours(23,59,59,999);

    // 1ª ETAPA: Varredura Normal (WMS -> SINGRA)
    data.forEach(wmsItem => {
      const wmsStatusRaw = wmsItem.STATUS || "";
      const wStatus = normalizeString(wmsStatusRaw);
      
      if (wStatus === "CANCELADO") return; 

      const pedidoOriginal = String(wmsItem.PEDIDO || wmsItem.RM || "").trim();
      const pedidoBusca = pedidoOriginal.replace(/^0+/, '').toUpperCase();
      
      // Salva na memória que essa RM existe no WMS
      wmsMap.add(pedidoBusca); 
      
      const singraItem = singraMap[pedidoBusca];
      const sStatusRaw = singraItem ? (singraItem.SITUACAO || singraItem.STATUS) : "";
      const sStatus = normalizeString(sStatusRaw);

      const processedItem = { ...wmsItem, singraStatus: sStatusRaw || "NÃO CONSTA NO SINGRA" };

      if (!singraItem) {
        if (wStatus === "EXPEDIDO") {
          const entryStr = safeGetISODate(wmsItem.DATA_ENTRADA);
          if (entryStr) {
            const entryDate = new Date(entryStr);
            if (entryDate >= startFilter && entryDate <= endFilter) {
              results.arrecadadoOms.push(processedItem);
            }
          }
        } else {
          // NOVO: RM está no WMS (presa/em processo) e SUMIU do Singra
          results.falhasInterface.push(processedItem);
        }
        return; 
      }

      if (singraItem) {
        if (sStatus === "EM TRANSITO" && wStatus === "CONFERIDO") {
          results.aguardandoRetirada.push(processedItem);
          return;
        }

        if (sStatus === "EM TRANSITO" && wStatus === "EXPEDIDO") {
          results.aguardandoArrecadacao.push(processedItem);
          return;
        }

        let isCasado = false;
        if (sStatus === "EM ATENDIMENTO" && (wStatus === "EM PLANEJAMENTO" || wStatus === "PLANEJAMENTO" || wStatus === "RESERVADO")) isCasado = true;
        else if (sStatus === "EM SEPARACAO" && (wStatus === "EM SEPARACAO" || wStatus === "SEPARACAO" || wStatus === "EM CONFERENCIA" || wStatus === "CONFERENCIA" || wStatus === "SEPARADO")) isCasado = true;
        else if (sStatus === "EM EXPEDICAO" && wStatus === "CONFERIDO") isCasado = true;
        else if (sStatus === "EM TRANSITO" && (wStatus === "CONFERIDO" || wStatus === "EXPEDIDO")) isCasado = true;

        if (!isCasado) {
          results.falhasInterface.push(processedItem);
        }
      }
    });

    // 2ª ETAPA: Varredura Reversa (SINGRA -> WMS)
    // O que está no SINGRA pendente e não desceu pro WMS?
    Object.values(singraMap).forEach(singraItem => {
      const pedidoKey = singraItem.ID || singraItem.PEDIDO || singraItem.RM || singraItem.DOCUMENTO;
      if (!pedidoKey) return;
      
      const safeKey = String(pedidoKey).replace(/^0+/, '').trim().toUpperCase();
      
      // Se essa RM NÃO foi vista durante o loop do WMS acima
      if (!wmsMap.has(safeKey)) {
        const sStatusRaw = singraItem.SITUACAO || singraItem.STATUS || "";
        const sStatus = normalizeString(sStatusRaw);
        
        // Se no Singra ela está como Finalizada/Cancelada a gente ignora para não poluir.
        // Focamos apenas nas que estão ATIVAS lá e sumidas no WMS:
        if (sStatus === "EM ATENDIMENTO" || sStatus === "EM SEPARACAO" || sStatus === "EM EXPEDICAO" || sStatus === "EM TRANSITO") {
           results.falhasInterface.push({
             PEDIDO: pedidoKey,
             PI: singraItem.PI || "-",
             STATUS: "NÃO CONSTA NO WMS", // Cria um alerta visual forte na coluna do WMS
             singraStatus: sStatusRaw,
             DATA_ENTRADA: singraItem.DATA_ENTRADA || singraItem.DATA_CADASTRO || null 
           });
        }
      }
    });

    return results;
  }, [data, singraData, interfaceStartDate, interfaceEndDate]);

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const filteredForCharts = data.filter(item => String(item.STATUS || "").toUpperCase().trim() !== "CANCELADO");
    const statsByDate = {};

    filteredForCharts.forEach(item => {
      const entryDate = safeGetISODate(item.DATA_ENTRADA);
      const separationDate = safeGetISODate(item.DATA_SEPARACAO);
      const status = String(item.STATUS || "").toUpperCase().trim();
      if (entryDate) {
        if (!statsByDate[entryDate]) statsByDate[entryDate] = { date: entryDate, entradas: 0, separacoes: 0, leadTimes: [] };
        statsByDate[entryDate].entradas += 1;
      }
      if (separationDate) {
        if (!statsByDate[separationDate]) statsByDate[separationDate] = { date: separationDate, entradas: 0, separacoes: 0, leadTimes: [] };
        statsByDate[separationDate].separacoes += 1;
        if (status === "EXPEDIDO" && entryDate) {
          const start = new Date(entryDate);
          const end = new Date(separationDate);
          const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0) statsByDate[separationDate].leadTimes.push(diffDays);
        }
      }
    });

    const sortedDates = Object.values(statsByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
    const calculateSimpleMA = (arr, index, period, key) => {
      if (index < period - 1) return null;
      let sum = 0;
      for (let i = 0; i < period; i++) sum += (arr[index - i][key] || 0);
      return parseFloat((sum / period).toFixed(2));
    };

    return sortedDates.map((day, idx) => {
      const dailyLeadAvg = day.leadTimes.length ? day.leadTimes.reduce((a, b) => a + b, 0) / day.leadTimes.length : 0;
      
      let sumLead7 = 0, countLead7 = 0;
      for(let i=0; i<7 && (idx-i)>=0; i++) {
         const val = sortedDates[idx-i].leadTimes.length ? sortedDates[idx-i].leadTimes.reduce((a,b)=>a+b,0)/sortedDates[idx-i].leadTimes.length : 0;
         if (val > 0) { sumLead7 += val; countLead7++; }
      }
      const leadTimeMa7 = countLead7 > 0 ? sumLead7/countLead7 : null;

      return {
        ...day,
        ma7_entradas: calculateSimpleMA(sortedDates, idx, 7, 'entradas'),
        ma7_separacoes: calculateSimpleMA(sortedDates, idx, 7, 'separacoes'),
        leadTimeDaily: parseFloat(dailyLeadAvg.toFixed(2)),
        leadTimeMa7: leadTimeMa7 ? parseFloat(leadTimeMa7.toFixed(2)) : null,
        channelLower: leadTimeMa7 ? Math.max(0, leadTimeMa7 * 0.8) : 0,
        channelHeight: leadTimeMa7 ? leadTimeMa7 * 0.4 : 0
      };
    });
  }, [data]);

  // Sempre que chartData mudar (novos dados syncados), resetamos o filtro visível para mostrar tudo
  useEffect(() => {
    setVisibleRange(null);
  }, [chartData]);

  const visibleRangeData = useMemo(() => {
    if (!chartData.length) return [];
    if (!visibleRange) return chartData; // Retorna tudo se não houver filtro ativo
    return chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
  }, [chartData, visibleRange]);

  const selectionSummary = useMemo(() => {
    if (chartData.length === 0) return null;
    const startIndex = visibleRange ? visibleRange.startIndex : 0;
    const endIndex = visibleRange ? visibleRange.endIndex : chartData.length - 1;
    const viewSlice = chartData.slice(startIndex, endIndex + 1);
    
    const entradas = viewSlice.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
    const separacoes = viewSlice.reduce((acc, curr) => acc + (curr.separacoes || 0), 0);
    const validDaysSlice = viewSlice.filter(d => d.leadTimeDaily > 0);
    const avgLead = validDaysSlice.length ? (validDaysSlice.reduce((acc, c) => acc + c.leadTimeDaily, 0) / validDaysSlice.length).toFixed(1) : 0;
    return { entradas, separacoes, balanco: separacoes - entradas, numDias: viewSlice.length, mediaEntradasPeriodo: (entradas / viewSlice.length).toFixed(2), mediaSeparacoesPeriodo: (separacoes / viewSlice.length).toFixed(2), avgLeadTimePeriodo: avgLead };
  }, [chartData, visibleRange]);

  const slaAnalysis = useMemo(() => {
    if (data.length === 0 || chartData.length === 0) return { taxaNoPrazo: 0 };
    const startIndex = visibleRange ? visibleRange.startIndex : 0;
    const endIndex = visibleRange ? visibleRange.endIndex : chartData.length - 1;
    
    const startDate = new Date(chartData[startIndex]?.date);
    const endDate = new Date(chartData[endIndex]?.date);

    let expedidosTotal = 0;
    let expedidosNoPrazo = 0;
    const metaSlaDias = 20; 

    data.forEach(item => {
      const sepDateStr = safeGetISODate(item.DATA_SEPARACAO);
      const entryDateStr = safeGetISODate(item.DATA_ENTRADA);
      const status = String(item.STATUS || "").toUpperCase().trim();

      if (status === "EXPEDIDO" && sepDateStr && entryDateStr) {
        const sepDate = new Date(sepDateStr);
        if (sepDate >= startDate && sepDate <= endDate) {
          expedidosTotal++;
          const entryDate = new Date(entryDateStr);
          const diffDays = Math.ceil((sepDate - entryDate) / (1000 * 60 * 60 * 24));
          if (diffDays <= metaSlaDias) expedidosNoPrazo++;
        }
      }
    });

    const taxa = expedidosTotal > 0 ? ((expedidosNoPrazo / expedidosTotal) * 100).toFixed(1) : 0;
    return { taxaNoPrazo: taxa };
  }, [data, chartData, visibleRange]);

  const dynamicAnalysis = useMemo(() => {
    if (data.length === 0 || chartData.length === 0) return { monthly: [], piStats: { delivered: 0, cancelled: 0, totalUnique: 0 } };
    const startIndex = visibleRange ? visibleRange.startIndex : 0;
    const endIndex = visibleRange ? visibleRange.endIndex : chartData.length - 1;
    const startDate = new Date(chartData[startIndex]?.date);
    const endDate = new Date(chartData[endIndex]?.date);
    
    const filteredRaw = data.filter(item => {
      const d = safeGetISODate(item.DATA_ENTRADA);
      if (!d) return false;
      const itemDate = new Date(d);
      return itemDate >= startDate && itemDate <= endDate;
    });
    const months = {};
    const piDelivered = new Set();
    const piCancelled = new Set();
    filteredRaw.forEach(item => {
      const dateStr = safeGetISODate(item.DATA_ENTRADA);
      const monthKey = dateStr.substring(0, 7);
      const status = String(item.STATUS || "").toUpperCase().trim();
      const pi = item.PI;
      if (!months[monthKey]) months[monthKey] = { month: monthKey, liberados: 0, cancelados: 0 };
      if (status === "CANCELADO") {
        months[monthKey].cancelados += 1;
        if (pi) piCancelled.add(pi);
      } else {
        months[monthKey].liberados += 1;
        if (status === "EXPEDIDO" && pi) piDelivered.add(pi);
      }
    });
    return {
      monthly: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
      piStats: { delivered: piDelivered.size, cancelled: piCancelled.size, totalUnique: new Set([...piDelivered, ...piCancelled]).size }
    };
  }, [data, chartData, visibleRange]);

  const backlogAnalysis = useMemo(() => {
    if (data.length === 0) return null;
    const today = new Date();
    
    const filteredData = data.filter(item => {
      const entryDateIso = safeGetISODate(item.DATA_ENTRADA);
      if (!entryDateIso) return true;
      const itemDate = new Date(entryDateIso);
      
      if (backlogStartDate && itemDate < new Date(backlogStartDate)) return false;
      if (backlogEndDate) {
        const endLimit = new Date(backlogEndDate);
        endLimit.setHours(23, 59, 59, 999);
        if (itemDate > endLimit) return false;
      }
      return true;
    });

    const pendingOrders = filteredData.filter(item => {
      const status = String(item.STATUS || "").toUpperCase().trim();
      return status !== "EXPEDIDO" && status !== "CANCELADO";
    });

    const pendingWithAge = pendingOrders.map(item => {
      const entryDateIso = safeGetISODate(item.DATA_ENTRADA);
      let daysOpen = 0;
      if (entryDateIso) {
        const entry = new Date(entryDateIso);
        daysOpen = Math.floor((today - entry) / (1000 * 60 * 60 * 24));
      }
      return { ...item, daysOpen, entryDateIso };
    }).sort((a, b) => b.daysOpen - a.daysOpen); 

    const buckets = [
      { name: '0-3 Dias', min: 0, max: 3, total: 0 },
      { name: '4-7 Dias', min: 4, max: 7, total: 0 },
      { name: '8-14 Dias', min: 8, max: 14, total: 0 },
      { name: '15-30 Dias', min: 15, max: 30, total: 0 },
      { name: '30+ Dias', min: 31, max: 99999, total: 0 }
    ];

    const uniqueStatusesSet = new Set();
    pendingWithAge.forEach(order => {
      const bucket = buckets.find(b => order.daysOpen >= b.min && order.daysOpen <= b.max);
      if (bucket) {
          bucket.total++;
          const status = String(order.STATUS || "N/A").toUpperCase().trim();
          bucket[status] = (bucket[status] || 0) + 1;
          uniqueStatusesSet.add(status);
      }
    });

    const totalPending = pendingWithAge.length;
    const avgAge = totalPending > 0 ? (pendingWithAge.reduce((acc, curr) => acc + curr.daysOpen, 0) / totalPending).toFixed(1) : 0;
    const oldestOrder = totalPending > 0 ? pendingWithAge[0] : null;
    const statusDist = {};
    pendingWithAge.forEach(order => {
      const st = String(order.STATUS || "N/A").toUpperCase().trim();
      statusDist[st] = (statusDist[st] || 0) + 1;
    });
    const statusChartData = Object.entries(statusDist).map(([name, value]) => ({ name, value }));

    const uniqueStatuses = Array.from(uniqueStatusesSet).sort();

    return {
      pendingOrders: pendingWithAge, buckets, totalPending, avgAge, oldestOrder, statusChartData,
      topOffenders: pendingWithAge.slice(0, 10), uniqueStatuses
    };
  }, [data, backlogStartDate, backlogEndDate]);

  const analyzeWithAI = async () => {
    if (!chartData || chartData.length === 0 || isAnalyzing || !selectionSummary) return;
    setIsAnalyzing(true);
    setAiError("");
    setAiAnalysis("");
    try {
      const totalEntradasHist = chartData.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
      const totalSaidasHist = chartData.reduce((acc, curr) => acc + (curr.separacoes || 0), 0);
      const mediaHistoricaSaidas = chartData.length > 0 ? (totalSaidasHist / chartData.length).toFixed(2) : 0;
      const picoHistorico = chartData.length > 0 ? Math.max(...chartData.map(d => d.separacoes || 0)) : 0;
      const mediaLeadHistorico = chartData.length > 0 ? (chartData.reduce((acc, curr) => acc + (curr.leadTimeDaily || 0), 0) / chartData.length).toFixed(2) : 0;
      const resumoErrosInterface = interfaceAnalysis?.falhasInterface.length || 0;

      const userQuery = `Analise em formato executivo: Histórico Entradas ${totalEntradasHist}, Saídas ${totalSaidasHist}, Média ${mediaHistoricaSaidas}, Lead Time ${mediaLeadHistorico}. Período selecionado: Entradas ${selectionSummary.entradas}, Saídas ${selectionSummary.separacoes}, SLA ${slaAnalysis.taxaNoPrazo}%. Backlog: ${backlogAnalysis?.totalPending} pedidos. Interface: ${resumoErrosInterface} divergências.`;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent({
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: "Você é um consultor sênior de Supply Chain. Gere um diagnóstico operacional fluido, sem asteriscos ou tabelas, focado em ajudar o tomador de decisão. Use os rótulos originais: Entradas (Corte), Saídas (Corte), SLA (Até 20 dias)." }] }
      });
      const rawText = result.response.text();
      setAiAnalysis(rawText.replace(/[#*`>-]/g, "").trim());
    } catch (err) {
      setAiError(err.message || "Erro ao conectar com a Inteligência Artificial.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderPiDetailsModal = () => {
    if (!selectedPiSegment) return null;
    const startIndex = visibleRange ? visibleRange.startIndex : 0;
    const endIndex = visibleRange ? visibleRange.endIndex : chartData.length - 1;
    const startDate = new Date(chartData[startIndex]?.date);
    const endDate = new Date(chartData[endIndex]?.date);
    const targetType = selectedPiSegment; 
    
    const filteredList = data.filter(item => {
      const d = safeGetISODate(item.DATA_ENTRADA);
      if (!d) return false;
      const itemDate = new Date(d);
      if (itemDate < startDate || itemDate > endDate) return false;
      const status = String(item.STATUS || "").toUpperCase().trim();
      if (!item.PI) return false; 
      return targetType === 'cancelled' ? status === "CANCELADO" : status === "EXPEDIDO";
    });
    
    const title = targetType === 'cancelled' ? 'PIs Cancelados no Período' : 'PIs Entregues no Período';
    const colorClass = targetType === 'cancelled' ? 'text-red-600' : 'text-emerald-600';
    
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setSelectedPiSegment(null)}>
        <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className={`text-xl font-black flex items-center gap-2 ${colorClass}`}><Package />{title}</h3>
              <p className="text-sm text-slate-500 font-medium mt-1">Listando {filteredList.length} registros no período selecionado</p>
            </div>
            <button onClick={() => setSelectedPiSegment(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={24} /></button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left text-slate-600">
              <thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10">
                <tr><th className="px-6 py-4">PI</th><th className="px-6 py-4">Pedido</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Data Entrada</th></tr>
              </thead>
              <tbody>
                {filteredList.map((order, idx) => (
                  <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-6 py-4 font-bold text-slate-800 font-mono">{order.PI || "-"}</td>
                    <td className="px-6 py-4 font-medium text-slate-600">{order.PEDIDO || "S/N"}</td>
                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded-md text-xs font-bold border ${targetType === 'cancelled' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{order.STATUS}</span></td>
                    <td className="px-6 py-4 font-medium">{order.DATA_ENTRADA ? safeGetISODate(order.DATA_ENTRADA).split('-').reverse().join('/') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderBucketDetailsModal = () => {
    if (!selectedBucket) return null;
    const filteredOrders = backlogAnalysis.pendingOrders.filter(order => order.daysOpen >= selectedBucket.min && order.daysOpen <= selectedBucket.max);
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setSelectedBucket(null)}>
        <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><ListFilter className="text-indigo-600" /> Detalhamento: {selectedBucket.name}</h3>
              <p className="text-sm text-slate-500 font-medium mt-1">Listando {filteredOrders.length} pedidos nesta faixa</p>
            </div>
            <button onClick={() => setSelectedBucket(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={24} /></button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left text-slate-600">
              <thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10">
                <tr><th className="px-6 py-4">Pedido</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Data Entrada</th><th className="px-6 py-4 text-right">Dias na Fila</th></tr>
              </thead>
              <tbody>
                {filteredOrders.map((order, idx) => (
                  <tr key={idx} className="border-b border-slate-50">
                    <td className="px-6 py-4 font-bold text-slate-800">{order.PEDIDO || "S/N"}</td>
                    <td className="px-6 py-4"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">{order.STATUS}</span></td>
                    <td className="px-6 py-4 font-medium">{new Date(order.entryDateIso).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-700">{order.daysOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderDashboard = () => {
    const estimativaZerarFila = selectionSummary?.mediaSeparacoesPeriodo > 0 ? (backlogAnalysis?.totalPending / selectionSummary.mediaSeparacoesPeriodo).toFixed(1) : "N/A";
    
    // Calcula corretamente as datas para exibição baseada na nulidade do visibleRange
    const startIdx = visibleRange ? visibleRange.startIndex : 0;
    const endIdx = visibleRange ? visibleRange.endIndex : chartData.length - 1;

    return (
      <div className="space-y-6 animate-in fade-in zoom-in duration-300">
        {renderPiDetailsModal()}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
               <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Entradas (Corte)</p>
               <InfoButton title="Entradas (Corte)" description="Total de pedidos que entraram no sistema WMS no período selecionado." />
            </div>
            <p className="text-2xl font-black text-slate-800">{selectionSummary?.entradas.toLocaleString()}</p>
            <div className="mt-1 text-[10px] text-indigo-600 font-bold flex items-center gap-1"><TrendingUp size={12} /> {selectionSummary?.mediaEntradasPeriodo}/dia</div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
               <p className="text-emerald-500 text-[10px] font-black uppercase tracking-widest italic">Saídas (Corte)</p>
               <InfoButton title="Saídas (Corte)" description="Total de pedidos que foram expedidos/concluídos pelo WMS no período filtrado." />
            </div>
            <p className="text-2xl font-black text-slate-800">{selectionSummary?.separacoes.toLocaleString()}</p>
            <div className="mt-1 text-[10px] text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 size={12} /> {selectionSummary?.mediaSeparacoesPeriodo}/dia</div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
               <p className="text-blue-500 text-[10px] font-black uppercase tracking-widest italic">SLA (Até 20 dias)</p>
               <InfoButton title="SLA (Nível de Serviço)" description="Percentual de pedidos expedidos em até 20 dias a partir da data de entrada. Meta padrão da operação." />
            </div>
            <p className="text-2xl font-black text-slate-800">{slaAnalysis?.taxaNoPrazo}%</p>
            <div className="mt-1 text-[10px] text-blue-600 font-bold flex items-center gap-1"><Target size={12} /> No prazo definido</div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
               <p className="text-purple-500 text-[10px] font-black uppercase tracking-widest italic">Lead Time Médio</p>
               <InfoButton title="Lead Time Médio" description="Tempo médio (em dias) que os pedidos levaram desde a entrada até a expedição final no período." />
            </div>
            <p className="text-2xl font-black text-slate-800">{selectionSummary?.avgLeadTimePeriodo} <span className="text-xs text-slate-400 font-bold">dias</span></p>
            <div className="mt-1 text-[10px] text-purple-600 font-bold flex items-center gap-1"><Clock size={12} /> (Expedidos)</div>
          </div>
          <div className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${selectionSummary?.balanco >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
             <div className="flex items-center justify-between mb-1">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest italic">Balanço</p>
                <InfoButton title="Balanço Operacional" description="Diferença entre Saídas e Entradas. Se positivo, estamos reduzindo o backlog; se negativo, a fila está crescendo." />
             </div>
             <p className={`text-2xl font-black ${selectionSummary?.balanco >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
               {selectionSummary?.balanco > 0 ? `+${selectionSummary?.balanco}` : selectionSummary?.balanco}
             </p>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
               <p className="text-orange-500 text-[10px] font-black uppercase tracking-widest italic">Zerar Backlog</p>
               <InfoButton title="Estimativa de Zeragem" description="Projeção de quantos dias seriam necessários para expedir todo o backlog atual baseado no ritmo médio de saída." />
            </div>
            <p className="text-2xl font-black text-slate-800">{estimativaZerarFila} <span className="text-xs text-slate-400 font-bold">dias</span></p>
            <div className="mt-1 text-[10px] text-orange-600 font-bold flex items-center gap-1"><RefreshCw size={12} /> Previsão de fila</div>
          </div>
          <button onClick={analyzeWithAI} disabled={isAnalyzing} className="group p-6 rounded-3xl shadow-lg transition-all flex flex-col justify-center items-start bg-indigo-600 text-white hover:bg-indigo-700 overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-indigo-200 italic">Consultoria AI</p>
            <div className="flex items-center gap-2 w-full justify-between relative z-10">
              <span className="text-lg font-bold">Analisar ✨</span>
              {isAnalyzing ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            </div>
          </button>
        </div>

        {aiAnalysis && (
          <div className="p-1 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-[34px] shadow-xl mt-4">
            <div className="p-8 bg-white rounded-[32px]">
              <div className="flex items-center gap-3 mb-4"><Target className="text-indigo-600" /><h3 className="text-lg font-black">Diagnóstico Operacional</h3></div>
              <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{aiAnalysis}</div>
            </div>
          </div>
        )}

        <div className="bg-white p-6 rounded-[30px] shadow-sm border border-slate-200 mb-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
               <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Seleção de Período de Análise</h3>
               <InfoButton title="Seleção de Período" description="Arraste as alças para filtrar o intervalo de tempo que deseja analisar nos gráficos e indicadores acima." />
            </div>
            <div className="text-sm font-semibold text-slate-600">
              {chartData[startIdx]?.date && chartData[endIdx]?.date && (
                <>{new Date(chartData[startIdx].date).toLocaleDateString('pt-BR')} — {new Date(chartData[endIdx].date).toLocaleDateString('pt-BR')}</>
              )}
            </div>
          </div>
          <div className="h-[60px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <XAxis dataKey="date" hide />
                <Brush 
                  dataKey="date" 
                  height={35} 
                  stroke="#cbd5e1" 
                  fill="#f1f5f9" 
                  travellerWidth={12} 
                  startIndex={startIdx}
                  endIndex={endIdx}
                  onChange={(r) => {
                    if (r && r.startIndex !== undefined && r.endIndex !== undefined) {
                      setVisibleRange({startIndex: r.startIndex, endIndex: r.endIndex});
                    }
                  }} 
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-6">
               <h3 className="text-lg font-black text-slate-800">Taxa de Liberação X Taxa de Expedição</h3>
               <InfoButton title="Tendência de Fluxo" description="Comparação entre o que entra (Liberação) e o que sai (Expedição). As linhas MM7 suavizam as oscilações para mostrar a tendência real." />
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visibleRangeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{fontSize: 10}} axisLine={false} />
                  <Tooltip labelFormatter={v => `Data: ${new Date(v).toLocaleDateString('pt-BR')}`} />
                  <Legend verticalAlign="top" align="right" />
                  <Bar dataKey="entradas" name="Vol. Entrada" fill="#e2e8f0" barSize={8} radius={[4,4,0,0]} />
                  <Line type="monotone" dataKey="ma7_entradas" name="MM7 Liberação" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="ma7_separacoes" name="MM7 Saída" stroke="#10b981" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-slate-800">Tempo de Atendimento</h3>
                <InfoButton title="Aging Lead Time" description="Evolução diária do tempo de atendimento. A área sombreada mostra o 'Desvio', indicando dias de muita instabilidade no processo." />
              </div>
              <div className="bg-indigo-50 px-3 py-1 rounded-full text-[10px] text-indigo-600 font-black">FILTRO: {selectionSummary?.numDias} DIAS</div>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visibleRangeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={v => v.split('-')[2]} />
                  <YAxis unit="d" tick={{fontSize: 10}} axisLine={false} />
                  <Tooltip labelFormatter={v => `Data: ${new Date(v).toLocaleDateString('pt-BR')}`} />
                  <Legend verticalAlign="top" align="right" />
                  <Area type="monotone" dataKey="channelLower" stackId="volStack" stroke="none" fill="transparent" legendType="none" />
                  <Area type="monotone" dataKey="channelHeight" name="Volatilidade (Desvio)" stackId="volStack" stroke="none" fill="#d8b4fe" opacity={0.3} />
                  <Line type="monotone" dataKey="leadTimeMa7" name="MM7 Atendimento" stroke="#7c3aed" strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
            <div className="flex items-center gap-2 mb-6">
               <XCircle className="text-red-500" size={20} />
               <h3 className="text-lg font-black text-slate-800">Cancelados vs Liberados (Dinâmico)</h3>
               <InfoButton title="Saúde dos Pedidos" description="Monitora mensalmente o volume de pedidos que entraram no fluxo e quantos foram descartados/cancelados." />
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dynamicAnalysis.monthly}>
                  <XAxis dataKey="month" tick={{fontSize: 10, fontWeight: 700}} />
                  <YAxis tick={{fontSize: 10}} axisLine={false} />
                  <Tooltip /><Legend />
                  <Bar dataKey="liberados" name="Liberados" fill="#6366f1" radius={[4,4,0,0]} />
                  <Bar dataKey="cancelados" name="Cancelados" fill="#ef4444" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
            <div className="flex items-center gap-2 mb-6">
               <Package className="text-amber-500" size={20} />
               <h3 className="text-lg font-black text-slate-800">PI cancelados no período X PI fornecidos</h3>
               <InfoButton title="Análise de PI" description="Mede a conversão de Documentos de Importação (PI). Clique nas fatias para listar exatamente quais foram cancelados ou entregues." />
            </div>
            <div className="flex flex-col md:flex-row items-center gap-8 h-[300px]">
              <div className="w-full md:w-1/2 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ name: 'PIs Entregues', value: dynamicAnalysis.piStats.delivered, type: 'delivered' }, { name: 'PIs Cancelados', value: dynamicAnalysis.piStats.cancelled, type: 'cancelled' }]} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" onClick={(d) => setSelectedPiSegment(d.type)}>
                      <Cell fill="#10b981" className="cursor-pointer hover:opacity-80" />
                      <Cell fill="#f43f5e" className="cursor-pointer hover:opacity-80" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full md:w-1/2 space-y-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100"><p className="text-[10px] font-black text-slate-400 uppercase">PIs Únicos</p><p className="text-xl font-black text-slate-800">{dynamicAnalysis.piStats.totalUnique}</p></div>
                <div className="bg-red-50 p-4 rounded-2xl border border-red-100"><p className="text-[10px] font-black text-red-400 uppercase">Taxa de cancelamento</p><p className="text-xl font-black text-red-600">{dynamicAnalysis.piStats.totalUnique > 0 ? ((dynamicAnalysis.piStats.cancelled / dynamicAnalysis.piStats.totalUnique) * 100).toFixed(1) : 0}%</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBacklogAnalysis = () => {
    if (!backlogAnalysis || (backlogAnalysis.totalPending === 0 && !backlogStartDate && !backlogEndDate)) {
      return (
        <div className="mt-20 flex flex-col items-center justify-center text-center">
          <div className="w-32 h-32 bg-emerald-50 rounded-full flex items-center justify-center mb-6"><CheckCircle2 size={48} className="text-emerald-500" /></div>
          <h2 className="text-2xl font-black text-slate-800">Fluxo Limpo!</h2>
          <p className="text-slate-400 mt-2">Nenhum pedido pendente encontrado.</p>
        </div>
      );
    }
    const metaSlaDias = 20;

    return (
      <div className="space-y-8 animate-in fade-in zoom-in duration-300">
        {renderBucketDetailsModal()}
        
        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 mb-1">
              <Calendar size={16} className="text-indigo-500" /> Filtro por Data de Liberação (Entrada)
              <InfoButton title="Filtro de Backlog" description="Filtre os pedidos pendentes pela data em que deram entrada no sistema. O padrão exibe o total acumulado." />
            </h3>
            <p className="text-xs text-slate-500 font-medium">Filtro para analisar o envelhecimento de pedidos de um período específico.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Início</label>
              <input type="date" value={backlogStartDate} onChange={e => setBacklogStartDate(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-colors" />
            </div>
            <div className="relative">
              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Fim</label>
              <input type="date" value={backlogEndDate} onChange={e => setBacklogEndDate(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-colors" />
            </div>
            {(backlogStartDate || backlogEndDate) && (
              <button 
                onClick={() => { setBacklogStartDate(""); setBacklogEndDate(""); }}
                className="mt-5 p-2 text-slate-400 hover:text-red-500 transition-colors bg-slate-100 rounded-full"
                title="Limpar Filtro"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-8 rounded-[32px] border border-slate-200 flex flex-col justify-between h-40">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2"><Hourglass size={14} /> Total em Aberto</p>
              <InfoButton title="Volume em Aberto" description="Quantidade de pedidos pendentes no fluxo (considerando o filtro de data selecionado)." />
            </div>
            <p className="text-4xl font-black text-slate-800">{backlogAnalysis.totalPending}</p>
            <p className="text-xs text-slate-400 font-medium">{backlogStartDate || backlogEndDate ? "Visão filtrada" : "Visão histórica total"}</p>
          </div>
          <div className="bg-white p-8 rounded-[32px] border border-slate-200 flex flex-col justify-between h-40">
            <div className="flex items-center justify-between">
               <p className="text-orange-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2"><Clock size={14} /> Idade Média da Fila</p>
               <InfoButton title="Aging Médio" description="Média de dias de espera dos pedidos que ainda estão abertos no filtro atual." />
            </div>
            <p className="text-4xl font-black text-orange-600">{backlogAnalysis.avgAge} <span className="text-lg text-slate-400">dias</span></p>
            <p className="text-xs text-slate-400 font-medium">Tempo médio de fila</p>
          </div>
          <div className="bg-white p-8 rounded-[32px] border border-slate-200 flex flex-col justify-between h-40 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between">
                <p className="text-red-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2"><AlertTriangle size={14} /> Pedido Mais Antigo</p>
                <InfoButton title="Gargalo Crítico" description="O pedido que está há mais tempo parado na fila (considerando o filtro selecionado)." />
              </div>
              <p className="text-4xl font-black text-red-600">{backlogAnalysis.oldestOrder ? `${backlogAnalysis.oldestOrder.daysOpen} dias` : '-'}</p>
            </div>
            <AlertTriangle className="absolute -bottom-4 -right-4 text-red-50 opacity-50" size={120} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-8 rounded-[40px] border border-slate-200">
            <div className="flex items-center justify-between mb-6">
               <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><Activity className="text-indigo-500" /> Pedidos em processamento (Fila de Espera)</h3>
               <InfoButton title="Aging por Status" description="Distribuição dos pedidos pendentes por tempo de abertura. Clique nas barras para listar detalhes." />
            </div>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={backlogAnalysis.buckets} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11, fontWeight: 700}} axisLine={false} />
                  <Tooltip cursor={{fill: '#f8fafc'}} />
                  <Legend wrapperStyle={{fontSize: '10px'}} />
                  {backlogAnalysis.uniqueStatuses.map((status) => (
                      <Bar 
                        key={status} 
                        dataKey={status} 
                        stackId="a" 
                        fill={getStatusColor(status)} 
                        barSize={32} 
                        onClick={(d) => setSelectedBucket(d.payload)} 
                        className="cursor-pointer hover:opacity-80 transition-opacity" 
                      />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white p-8 rounded-[40px] border border-slate-200">
            <div className="flex items-center justify-between mb-6">
               <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><ListFilter className="text-indigo-500" /> Onde estão parados?</h3>
               <InfoButton title="Status Operacional" description="Distribuição dos pedidos pendentes pelas etapas do WMS." />
            </div>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={backlogAnalysis.statusChartData} 
                    innerRadius={80} 
                    outerRadius={110} 
                    dataKey="value" 
                    paddingAngle={4}
                  >
                    {backlogAnalysis.statusChartData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getStatusColor(entry.name)} 
                        className="cursor-pointer hover:opacity-80 transition-opacity"
                      />
                    ))}
                  </Pie>
                  <Tooltip /><Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '11px'}} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[40px] border border-slate-200">
           <div className="flex items-center justify-between mb-6">
             <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><AlertTriangle className="text-red-500" /> Top 10 Pedidos Críticos (Fila de Espera)</h3>
             <button 
               onClick={() => handleDownloadExcel(backlogAnalysis.pendingOrders, `Relatorio_Backlog`)}
               className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors shadow-sm"
             >
               <Download size={16} /> Exportar Lista Filtrada
             </button>
           </div>
           <div className="overflow-x-auto">
             <table className="w-full text-sm text-left">
               <thead className="bg-slate-50 text-slate-400 uppercase text-xs">
                 <tr><th className="px-6 py-4">Pedido</th><th className="px-6 py-4">Status Atual</th><th className="px-6 py-4">Data Entrada</th><th className="px-6 py-4 text-right">Dias em Aberto</th></tr>
               </thead>
               <tbody>
                 {backlogAnalysis.topOffenders.length > 0 ? (
                   backlogAnalysis.topOffenders.map((order, idx) => (
                     <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                       <td className="px-6 py-4 font-bold text-slate-800 font-mono">{order.PEDIDO || order.PI || "S/N"}</td>
                       <td className="px-6 py-4"><span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-xs font-bold border border-indigo-100">{order.STATUS}</span></td>
                       <td className="px-6 py-4 font-medium text-slate-500">{order.entryDateIso ? new Date(order.entryDateIso).toLocaleDateString('pt-BR') : '-'}</td>
                       <td className="px-6 py-4 text-right"><span className={`px-3 py-1 rounded-full text-xs font-black ${order.daysOpen > metaSlaDias ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>{order.daysOpen} dias</span></td>
                     </tr>
                   ))
                 ) : (
                   <tr><td colSpan="4" className="px-6 py-10 text-center text-slate-400 font-medium italic">Nenhum pedido pendente encontrado no filtro aplicado.</td></tr>
                 )}
               </tbody>
             </table>
           </div>
        </div>
      </div>
    );
  };

  const renderInterfaceView = () => {
    if (!interfaceAnalysis) return null;
    const views = {
      aguardandoRetirada: { title: "Aguardando Retirada de Material", data: interfaceAnalysis.aguardandoRetirada, color: "text-blue-600", bg: "bg-blue-50", desc: "Pedidos em trânsito no SINGRA e conferidos no WMS." },
      aguardandoArrecadacao: { title: "Aguardando Arrecadação OMS", data: interfaceAnalysis.aguardandoArrecadacao, color: "text-orange-600", bg: "bg-orange-50", desc: "Expedidos fisicamente, mas sem baixa no SINGRA." },
      arrecadadoOms: { title: "Arrecadado pela OMS", data: interfaceAnalysis.arrecadadoOms, color: "text-emerald-600", bg: "bg-emerald-50", desc: "Finalizados com sucesso nos dois sistemas." },
      falhasInterface: { title: "Falhas de Interface Sistêmica", data: interfaceAnalysis.falhasInterface, color: "text-red-600", bg: "bg-red-50", desc: "Divergências críticas onde os status não coincidem logicamente." }
    };
    const currentList = views[activeInterfaceView].data;
    const displayedList = activeInterfaceView === 'falhasInterface' && selectedErrorFilter
        ? currentList.filter(item => `${item.STATUS || 'N/A'}-${item.singraStatus || 'N/A'}` === selectedErrorFilter)
        : currentList;
    return (
      <div className="space-y-6 animate-in fade-in zoom-in duration-300">
        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 mb-1"><Calendar size={16} className="text-indigo-500" /> Filtro de Período (Arrecadados OMS)</h3>
            <p className="text-xs text-slate-500 font-medium">
              Como os pedidos "Arrecadados" não constam mais no SINGRA, nós filtramos a busca por data de entrada para não travar o sistema com o histórico completo de 5 anos. <span className="text-indigo-500 font-bold">Os demais status ("Descasados", "Em Trânsito") não sofrem esse filtro para garantir que nenhum erro antigo seja esquecido.</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input type="date" value={interfaceStartDate} onChange={e => setInterfaceStartDate(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold shadow-sm" />
            <input type="date" value={interfaceEndDate} onChange={e => setInterfaceEndDate(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold shadow-sm" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Object.entries(views).map(([key, view]) => (
            <button key={key} onClick={() => { setActiveInterfaceView(key); setSelectedErrorFilter(null); }} className={`text-left p-6 rounded-3xl border-2 transition-all ${activeInterfaceView === key ? 'border-indigo-400 bg-white shadow-sm scale-105' : 'border-transparent ' + view.bg + ' opacity-70 hover:opacity-100'}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                 <p className={`text-[10px] font-black uppercase leading-tight ${view.color}`}>{view.title}</p>
                 <InfoButton title={view.title} description={view.desc} />
              </div>
              <p className="text-3xl font-black text-slate-800 mt-2">{view.data.length}</p>
            </button>
          ))}
        </div>
        <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
           <div className="flex justify-between items-center mb-6">
             <h3 className={`text-xl font-black flex items-center gap-2 ${views[activeInterfaceView].color}`}><ArrowRightLeft size={24} /> {views[activeInterfaceView].title}</h3>
             <button onClick={() => handleDownloadExcel(displayedList, `Interface_${activeInterfaceView}`)} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-indigo-100 transition-colors shadow-sm"><Download size={16} /> Exportar Excel</button>
           </div>
           {activeInterfaceView === 'falhasInterface' && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
                 {Object.values(currentList.reduce((acc, item) => {
                     const key = `${item.STATUS || 'N/A'}-${item.singraStatus || 'N/A'}`;
                     if (!acc[key]) acc[key] = { key, wms: item.STATUS || 'N/A', singra: item.singraStatus || 'N/A', count: 0 };
                     acc[key].count++;
                     return acc;
                 }, {})).map(s => (
                    <div key={s.key} onClick={() => setSelectedErrorFilter(s.key === selectedErrorFilter ? null : s.key)} className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedErrorFilter === s.key ? 'border-red-500 bg-red-50 shadow-md scale-105' : 'border-slate-100 bg-slate-50 hover:border-red-200'}`}>
                       <p className="text-[9px] font-bold text-slate-400">WMS: {s.wms}</p>
                       <p className="text-[9px] font-bold text-slate-400">SINGRA: {s.singra}</p>
                       <p className="text-lg font-black text-red-600">{s.count}</p>
                    </div>
                 ))}
              </div>
           )}
           <div className="overflow-x-auto max-h-[400px]">
             <table className="w-full text-sm text-left text-slate-600">
               <thead className="bg-slate-50 text-slate-400 uppercase text-xs sticky top-0 z-10">
                 <tr><th className="px-6 py-4">Pedido / RM</th><th className="px-6 py-4">PI</th><th className="px-6 py-4">Status WMS</th><th className="px-6 py-4">Status SINGRA</th><th className="px-6 py-4">Data Entrada</th></tr>
               </thead>
               <tbody>
                 {displayedList.map((o, i) => (
                   <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                     <td className="px-6 py-4 font-bold text-slate-800 font-mono">{o.PEDIDO || "S/N"}</td>
                     <td className="px-6 py-4 font-medium text-slate-500">{o.PI || "-"}</td>
                     <td className="px-6 py-4"><span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-bold border border-indigo-100">{o.STATUS || "N/A"}</span></td>
                     <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs font-bold border ${o.singraStatus === 'NÃO CONSTA NO SINGRA' ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-white'}`}>{o.singraStatus || "N/A"}</span></td>
                     <td className="px-6 py-4 font-medium">{o.DATA_ENTRADA ? safeGetISODate(o.DATA_ENTRADA).split('-').reverse().join('/') : '-'}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      </div>
    );
  };
const renderEmailSearch = () => {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in duration-300">
        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Search className="text-indigo-500" size={20} />
            <h3 className="text-lg font-black text-slate-800">Extrator de RM por E-mail</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4 font-medium">Cole o texto do e-mail abaixo. O sistema buscará automaticamente padrões numéricos de 8 dígitos (com ou sem ponto) e cruzará os status.</p>
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder="Cole o texto do e-mail aqui..."
            className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none"
          />
        </div>

        {extractedOrders.length > 0 && (
          <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-slate-800">Resultados Encontrados ({extractedOrders.length})</h3>
              <button 
                onClick={() => setEmailText("")} 
                className="text-xs font-bold text-slate-400 hover:text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                Limpar Busca
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-600">
                <thead className="bg-slate-50 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-4 rounded-tl-xl">RM Extraída</th>
                    <th className="px-6 py-4">Status WMS</th>
                    <th className="px-6 py-4">Status SINGRA</th>
                    <th className="px-6 py-4 rounded-tr-xl">Data Entrada</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedOrders.map((res, idx) => (
                    <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800 font-mono">{res.idOriginal}</td>
                      <td className="px-6 py-4">
                         <span className={`px-2 py-1 rounded text-xs font-bold border ${res.wmsStatus === 'NÃO LOCALIZADO' ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                           {res.wmsStatus}
                         </span>
                      </td>
                      <td className="px-6 py-4">
                         <span className={`px-2 py-1 rounded text-xs font-bold border ${res.singraStatus === 'NÃO CONSTA' ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-800 text-white border-slate-700'}`}>
                           {res.singraStatus}
                         </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-500">
                        {res.dataEntrada ? res.dataEntrada.split('-').reverse().join('/') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };
  
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 overflow-x-hidden">
      <div className="w-full px-4 py-4 md:px-10 md:py-8 transition-all">
        <header className="mb-8 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 group">
              <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-lg transition-transform group-hover:scale-110"><Activity className="text-white" size={24} /></div>
              <div>
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">Supply Chain <span className="text-indigo-600">DepFMRJ</span></h1>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">WMS & Integração Singra</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <button onClick={() => performSync(true)} disabled={loading} className="px-6 py-2.5 rounded-xl font-bold bg-indigo-600 text-white shadow-sm flex items-center gap-2 hover:bg-indigo-700 transition-all text-sm disabled:opacity-50 active:scale-95">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />} Sincronizar Robôs
                </button>
                <label className="px-6 py-2.5 rounded-xl font-bold bg-white border border-slate-200 shadow-sm flex items-center gap-2 hover:border-indigo-500 hover:text-indigo-600 transition-all text-sm cursor-pointer active:scale-95">
                  <Upload size={18} /> {fileName || "Upload Manual"}
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              {lastSync && (
                <div className="text-[11px] text-slate-500 font-bold flex items-center gap-1.5 bg-slate-200/50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <Clock size={12} className="text-indigo-500" /> Última atualização: <span className="text-slate-700">{lastSync}</span>
                </div>
              )}
            </div>
          </div>
          {data.length > 0 && (
            <div className="flex p-1 bg-white rounded-2xl border border-slate-200 w-fit shadow-sm overflow-x-auto max-w-full">
              <button onClick={() => setActiveTab('dashboard')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-all ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><LayoutDashboard size={16} /> Indicadores</button>
              <button onClick={() => setActiveTab('backlog')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-all ${activeTab === 'backlog' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Hourglass size={16} /> RM em processamento</button>
              <button onClick={() => setActiveTab('interface')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-all ${activeTab === 'interface' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Network size={16} /> Interface SINGRA x WMS</button>
              <button onClick={() => setActiveTab('email')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-all ${activeTab === 'email' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Search size={16} /> Busca por E-mail</button>
            </div>
          )}
        </header>

        {data.length > 0 ? (
          activeTab === 'dashboard' ? renderDashboard() : 
          activeTab === 'backlog' ? renderBacklogAnalysis() : 
          activeTab === 'interface' ? renderInterfaceView() : 
          activeTab === 'email' ? renderEmailSearch() : null
        ) : (
          <div className="mt-32 text-center flex flex-col items-center animate-pulse">
             <div className={`w-40 h-40 bg-white rounded-[50px] shadow-2xl flex items-center justify-center mb-8 border border-slate-100`}>
               {loading ? <Loader2 size={60} className="text-indigo-500 animate-spin" /> : <Database size={60} className="text-indigo-500 opacity-20" />}
             </div>
             <h2 className="text-2xl font-black text-slate-800 tracking-tight">Supply Monitor Integrado</h2>
             <p className="text-slate-400 text-sm mt-2 font-medium">Aguarde o carregamento ou clique em Sincronizar Robôs.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
