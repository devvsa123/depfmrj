import React, { useState, useMemo, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ComposedChart, Bar, Brush, Area, PieChart, Pie, Cell, BarChart
} from 'recharts';
import { 
  Upload, FileSpreadsheet, TrendingUp, CheckCircle2, Sparkles, 
  Loader2, Activity, Target, Clock, AlertCircle, XCircle, Package
} from 'lucide-react';

const XLSX_SCRIPT_URL = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";

const App = () => {
  const [data, setData] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [libLoaded, setLibLoaded] = useState(false);
  
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
  
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");

  const apiKey = "AIzaSyB7-09YzTnSfZC-tYpdzPBbUbSDoWKDjX0"; 

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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !libLoaded) return;

    setLoading(true);
    setError("");
    setAiAnalysis("");
    setFileName(file.name);

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
              const normalizedKey = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
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

  // --- PROCESSAMENTO PARA GRÁFICOS DIÁRIOS (Fluxo e Lead Time) ---
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
    
    const calculateStats = (arr, index, period, key) => {
      if (index < period - 1) return { avg: null, stdDev: null };
      const slice = [];
      for (let i = 0; i < period; i++) {
        const val = arr[index - i][key];
        if (arr[index - i].separacoes > 0) {
            slice.push(val || 0);
        }
      }
      if (slice.length === 0) return { avg: 0, stdDev: 0 };
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      const stdDev = Math.sqrt(slice.map(v => Math.pow(v - avg, 2)).reduce((a, b) => a + b, 0) / slice.length);
      return { avg, stdDev };
    };

    const calculateSimpleMA = (arr, index, period, key) => {
      if (index < period - 1) return null;
      let sum = 0;
      for (let i = 0; i < period; i++) sum += (arr[index - i][key] || 0);
      return parseFloat((sum / period).toFixed(2));
    };

    return sortedDates.map((day, idx) => {
      const dailyLeadAvg = day.leadTimes.length ? day.leadTimes.reduce((a, b) => a + b, 0) / day.leadTimes.length : 0;
      day.tempLead = dailyLeadAvg;

      const stats7 = calculateStats(sortedDates, idx, 7, 'tempLead');
      const stats30 = calculateStats(sortedDates, idx, 30, 'tempLead');
      
      const leadTimeMa7 = stats7.avg;
      const leadTimeStdDev = stats7.stdDev;
      
      let channelLower = 0;
      let channelHeight = 0;

      if (leadTimeMa7 !== null) {
        channelLower = Math.max(0, leadTimeMa7 - leadTimeStdDev);
        channelHeight = (leadTimeMa7 + leadTimeStdDev) - channelLower;
      }

      return {
        ...day,
        ma7_entradas: calculateSimpleMA(sortedDates, idx, 7, 'entradas'),
        ma7_separacoes: calculateSimpleMA(sortedDates, idx, 7, 'separacoes'),
        leadTimeDaily: parseFloat(dailyLeadAvg.toFixed(2)),
        leadTimeMa7: leadTimeMa7 ? parseFloat(leadTimeMa7.toFixed(2)) : null,
        leadTimeMa30: stats30.avg ? parseFloat(stats30.avg.toFixed(2)) : null,
        channelLower: parseFloat(channelLower.toFixed(2)),
        channelHeight: parseFloat(channelHeight.toFixed(2)),
        leadTimeStdDev: leadTimeStdDev ? parseFloat(leadTimeStdDev.toFixed(2)) : null
      };
    });
  }, [data]);

  // --- ANÁLISE DINÂMICA (CANCELAMENTOS E PI) ---
  const dynamicAnalysis = useMemo(() => {
    if (data.length === 0 || chartData.length === 0) return { monthly: [], piStats: { delivered: 0, cancelled: 0, totalUnique: 0 } };

    const startDate = new Date(chartData[visibleRange.startIndex]?.date);
    const endDate = new Date(chartData[visibleRange.endIndex]?.date);

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
      piStats: {
        delivered: piDelivered.size,
        cancelled: piCancelled.size,
        totalUnique: new Set([...piDelivered, ...piCancelled]).size
      }
    };
  }, [data, chartData, visibleRange]);

  const selectionSummary = useMemo(() => {
    if (chartData.length === 0) return null;
    const viewSlice = chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    const entradas = viewSlice.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
    const separacoes = viewSlice.reduce((acc, curr) => acc + (curr.separacoes || 0), 0);
    const validDaysSlice = viewSlice.filter(d => d.leadTimeDaily > 0);
    const avgLead = validDaysSlice.length ? (validDaysSlice.reduce((acc, c) => acc + c.leadTimeDaily, 0) / validDaysSlice.length).toFixed(1) : 0;
    const avgStdDev = viewSlice.length ? (viewSlice.reduce((acc, c) => acc + (c.leadTimeStdDev || 0), 0) / viewSlice.length).toFixed(1) : 0;
    return { entradas, separacoes, balanco: separacoes - entradas, numDias: viewSlice.length, mediaEntradasPeriodo: (entradas / viewSlice.length).toFixed(2), mediaSeparacoesPeriodo: (separacoes / viewSlice.length).toFixed(2), avgLeadTimePeriodo: avgLead, avgStdDev };
  }, [chartData, visibleRange]);

  useEffect(() => {
    if (chartData.length > 0) {
      setVisibleRange({ startIndex: 0, endIndex: chartData.length - 1 });
    }
  }, [chartData]);

  const analyzeWithAI = async () => {
    if (!chartData.length || isAnalyzing) return;
    setIsAnalyzing(true);
    const userQuery = `DADOS: Entradas ${selectionSummary.entradas}, Saídas ${selectionSummary.separacoes}, LT ${selectionSummary.avgLeadTimePeriodo}d.`;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: userQuery }] }] })
      });
      const result = await response.json();
      setAiAnalysis(result.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (err) { setAiError("Erro na análise."); } finally { setIsAnalyzing(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 overflow-x-hidden">
      <div className="w-full px-4 py-4 md:px-10 md:py-8 transition-all duration-300">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-lg">
              <Activity className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">Supply Chain <span className="text-indigo-600">DepFMRJ</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Fluxo & Lead Time Analytics</p>
            </div>
          </div>
          <label className="cursor-pointer px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm bg-white border border-slate-200 hover:border-indigo-500 hover:text-indigo-600 text-sm">
            <Upload size={18} /> {fileName || "Carregar Planilha"}
            <input type="file" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={!libLoaded} />
          </label>
        </header>

        {data.length > 0 ? (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Entradas (Corte)</p>
                <p className="text-2xl font-black text-slate-800">{selectionSummary.entradas.toLocaleString()}</p>
                <div className="mt-1 text-[10px] text-indigo-600 font-bold flex items-center gap-1">
                  <TrendingUp size={12} /> {selectionSummary.mediaEntradasPeriodo}/dia
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-emerald-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Saídas (Corte)</p>
                <p className="text-2xl font-black text-slate-800">{selectionSummary.separacoes.toLocaleString()}</p>
                <div className="mt-1 text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                  <CheckCircle2 size={12} /> {selectionSummary.mediaSeparacoesPeriodo}/dia
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-purple-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Lead Time Médio</p>
                <p className="text-2xl font-black text-slate-800">{selectionSummary.avgLeadTimePeriodo} <span className="text-xs text-slate-400 font-bold">dias</span></p>
                <div className="mt-1 text-[10px] text-purple-600 font-bold flex items-center gap-1">
                  <Clock size={12} /> (Expedidos)
                </div>
              </div>
              <div className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${selectionSummary.balanco >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Balanço</p>
                <p className={`text-2xl font-black ${selectionSummary.balanco >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                  {selectionSummary.balanco > 0 ? `+${selectionSummary.balanco}` : selectionSummary.balanco}
                </p>
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
              <div className="p-1 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-[34px] shadow-xl">
                <div className="p-8 bg-white rounded-[32px]">
                  <div className="flex items-center gap-3 mb-4"><Target className="text-indigo-600" /><h3 className="text-lg font-black">Diagnóstico Operacional</h3></div>
                  <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{aiAnalysis}</div>
                </div>
              </div>
            )}

            {/* Seletor Global de Período */}
            <div className="bg-white p-6 rounded-[30px] shadow-sm border border-slate-200 mb-6">
            
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                  Seleção de Período de Análise
                </h3>
            
                <div className="text-xs text-slate-500 font-semibold">
                  {chartData[visibleRange.startIndex]?.date &&
                   chartData[visibleRange.endIndex]?.date && (
                    <>
                      {new Date(chartData[visibleRange.startIndex].date).toLocaleDateString('pt-BR')}
                      {"  —  "}
                      {new Date(chartData[visibleRange.endIndex].date).toLocaleDateString('pt-BR')}
                    </>
                  )}
                </div>
              </div>
            
              <div className="h-[70px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <XAxis 
                      dataKey="date"
                      tickFormatter={(val) =>
                        val ? new Date(val).toLocaleDateString('pt-BR') : ''
                      }
                      tick={{ fontSize: 10 }}
                    />
            
                    <Brush
                      dataKey="date"
                      height={40}
                      stroke="#cbd5e1"
                      fill="#f8fafc"
                      travellerWidth={10}
                      tickFormatter={(val) =>
                        val ? new Date(val).toLocaleDateString('pt-BR') : ''
                      }
                      onChange={(r) =>
                        r &&
                        setVisibleRange({
                          startIndex: r.startIndex,
                          endIndex: r.endIndex,
                        })
                      }
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            
            </div>

            {/* Fluxo + Lead Time lado a lado */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Volume de Fluxo */}
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
              <h3 className="text-lg font-black text-slate-800 mb-6">
                Volume de Fluxo Selecionado
              </h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} syncId="masterSync">
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
          
            {/* Lead Time e Brush */}
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-slate-800">
                  Tempo de Atendimento & Controle de Período
                </h3>
                <div className="bg-indigo-50 px-3 py-1 rounded-full text-[10px] text-indigo-600 font-black">
                  FILTRO: {selectionSummary.numDias} DIAS
                </div>
              </div>
          
              <div className="h-[420px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} syncId="masterSync">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      tick={{fontSize: 9, angle: -35, textAnchor: 'end'}} 
                      tickFormatter={v => v ? v.split('-')[2] + '/' + v.split('-')[1] : ''} 
                      height={60}
                    />
                    <YAxis unit="d" tick={{fontSize: 10}} axisLine={false} />
                    <Tooltip labelFormatter={v => `Data: ${new Date(v).toLocaleDateString('pt-BR')}`} />
                    <Legend verticalAlign="top" align="right" />
          
                    <Area 
                      type="monotone" 
                      dataKey="channelLower" 
                      stackId="volStack" 
                      stroke="none" 
                      fill="transparent" 
                      legendType="none" 
                      activeDot={false}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="channelHeight" 
                      name="Volatilidade (Desvio)"
                      stackId="volStack" 
                      stroke="none" 
                      fill="#d8b4fe" 
                      opacity={0.3} 
                    />
          
                    <Line type="monotone" dataKey="leadTimeMa30" name="MM30" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    <Line type="monotone" dataKey="leadTimeMa7" name="MM7 Atendimento" stroke="#7c3aed" strokeWidth={3} dot={false} />

                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          
          </div>

            {/* Cancelamentos e PIs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-6">
                  <XCircle className="text-red-500" size={20} />
                  <h3 className="text-lg font-black text-slate-800">Cancelados vs Liberados (Dinâmico)</h3>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dynamicAnalysis.monthly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{fontSize: 10, fontWeight: 700}} />
                      <YAxis tick={{fontSize: 10}} axisLine={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="liberados" name="Liberados" fill="#6366f1" radius={[4,4,0,0]} />
                      <Bar dataKey="cancelados" name="Cancelados" fill="#ef4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-6">
                  <Package className="text-amber-500" size={20} />
                  <h3 className="text-lg font-black text-slate-800">Eficiência de Itens (PI) no Período</h3>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-8 h-[300px]">
                  <div className="w-full md:w-1/2 h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'PIs Entregues', value: dynamicAnalysis.piStats.delivered },
                            { name: 'PIs Cancelados', value: dynamicAnalysis.piStats.cancelled }
                          ]}
                          innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                        >
                          <Cell fill="#10b981" /><Cell fill="#f43f5e" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full md:w-1/2 space-y-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase">PIs Únicos</p>
                      <p className="text-xl font-black text-slate-800">{dynamicAnalysis.piStats.totalUnique}</p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
                      <p className="text-[10px] font-black text-red-400 uppercase">Taxa de Perda</p>
                      <p className="text-xl font-black text-red-600">
                        {dynamicAnalysis.piStats.totalUnique > 0 ? ((dynamicAnalysis.piStats.cancelled / dynamicAnalysis.piStats.totalUnique) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-32 flex flex-col items-center justify-center text-center">
            <div className="w-40 h-40 bg-white rounded-[50px] shadow-2xl flex items-center justify-center mb-8 border border-slate-100">
              <FileSpreadsheet size={60} className="text-indigo-500 opacity-20" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Supply Monitor 3.6</h2>
            <p className="text-slate-400 text-sm max-w-sm mt-2 font-medium">
              Importe o arquivo do WMS para visualizar o painel analítico histórico.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
