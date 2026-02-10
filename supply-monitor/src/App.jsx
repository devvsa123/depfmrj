import React, { useState, useMemo, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ComposedChart, Bar, Brush, Area
} from 'recharts';
import { 
  Upload, FileSpreadsheet, TrendingUp, CheckCircle2, Sparkles, 
  Loader2, Activity, Target, Clock, AlertCircle
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

  // NOTA: Em produção, use variáveis de ambiente para chaves de API
  const apiKey = ""; 

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
        const day = brMatch[1].padStart(2, '0');
        const month = brMatch[2].padStart(2, '0');
        const year = brMatch[3];
        return `${year}-${month}-${day}`;
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

        const normalizedData = jsonData
          .map(item => {
            const newItem = {};
            Object.keys(item).forEach(key => {
              const normalizedKey = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
              newItem[normalizedKey] = item[key];
            });
            return newItem;
          })
          .filter(item => String(item.STATUS || "").toUpperCase().trim() !== "CANCELADO");

        setData(normalizedData);
      } catch (err) {
        setError("Erro ao processar o arquivo. Verifique se as colunas DATA_ENTRADA, DATA_SEPARACAO e STATUS existem.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    
    // 1. Agrupamento Inicial por Data
    const statsByDate = {};
   
    data.forEach(item => {
      const entryDate = safeGetISODate(item.DATA_ENTRADA);
      const separationDate = safeGetISODate(item.DATA_SEPARACAO);
      const status = String(item.STATUS || "").toUpperCase().trim();
     
      // Contagem de Entradas (Liberação)
      if (entryDate) {
        if (!statsByDate[entryDate]) statsByDate[entryDate] = { date: entryDate, entradas: 0, separacoes: 0, leadTimes: [] };
        statsByDate[entryDate].entradas += 1;
      }

      // Contagem de Saídas (Separação) e Cálculo de Lead Time
      if (separationDate) {
        if (!statsByDate[separationDate]) statsByDate[separationDate] = { date: separationDate, entradas: 0, separacoes: 0, leadTimes: [] };
        statsByDate[separationDate].separacoes += 1;

        // Lógica de Lead Time: Apenas para EXPEDIDO e datas válidas
        if (status === "EXPEDIDO" && entryDate) {
          const start = new Date(entryDate);
          const end = new Date(separationDate);
          const diffTime = end - start;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Filtra inconsistências (ex: data separação anterior a entrada)
          if (diffDays >= 0) {
            statsByDate[separationDate].leadTimes.push(diffDays);
          }
        }
      }
    });
   
    // 2. Ordenação e Cálculo de Médias Diárias
    const sortedDates = Object.values(statsByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Adiciona a média diária simples ao objeto
    sortedDates.forEach(day => {
      if (day.leadTimes.length > 0) {
        const sum = day.leadTimes.reduce((a, b) => a + b, 0);
        day.avgLeadTimeDaily = sum / day.leadTimes.length;
      } else {
        day.avgLeadTimeDaily = 0; // Ou null, dependendo de como quer tratar dias sem expedição
      }
    });

    // 3. Funções de Janela Móvel (Moving Averages & Std Dev)
    const calculateStats = (arr, index, period, key) => {
      if (index < period - 1) return { avg: null, stdDev: null };
      
      const slice = [];
      // Coleta valores válidos na janela (ignora dias sem dados para evitar puxar média para zero incorretamente)
      for (let i = 0; i < period; i++) {
        const val = arr[index - i][key];
        // Opcional: Se quiser considerar dias com 0 como 0, remova a verificação. 
        // Aqui assumimos que se avgLeadTimeDaily é > 0, houve expedição.
        if (arr[index - i].separacoes > 0) {
           slice.push(val || 0);
        }
      }

      if (slice.length === 0) return { avg: 0, stdDev: 0 };

      const sum = slice.reduce((a, b) => a + b, 0);
      const avg = sum / slice.length;

      const squareDiffs = slice.map(value => Math.pow(value - avg, 2));
      const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / slice.length;
      const stdDev = Math.sqrt(avgSquareDiff);

      return { avg, stdDev };
    };

    const calculateSimpleMA = (arr, index, period, key) => {
      if (index < period - 1) return null;
      let sum = 0;
      for (let i = 0; i < period; i++) sum += (arr[index - i][key] || 0);
      return parseFloat((sum / period).toFixed(2));
    };

    // 4. Mapeamento Final com Métricas Calculadas
    return sortedDates.map((day, idx) => {
      // Métricas de Volume
      const ma7_entradas = calculateSimpleMA(sortedDates, idx, 7, 'entradas');
      const ma7_separacoes = calculateSimpleMA(sortedDates, idx, 7, 'separacoes');
      const ma30_entradas = calculateSimpleMA(sortedDates, idx, 30, 'entradas');
      const ma30_separacoes = calculateSimpleMA(sortedDates, idx, 30, 'separacoes');

      // Métricas de Tempo (Lead Time)
      const stats7 = calculateStats(sortedDates, idx, 7, 'avgLeadTimeDaily');
      const stats30 = calculateStats(sortedDates, idx, 30, 'avgLeadTimeDaily');

      // Para o gráfico de Canal (Area Stacked), precisamos do "fundo" (bottom) e do "tamanho" (height)
      // Canal = Média +/- Desvio Padrão
      const leadTimeMa7 = stats7.avg;
      const leadTimeStdDev = stats7.stdDev;
      
      let channelLower = null;
      let channelHeight = null;

      if (leadTimeMa7 !== null) {
        const lowerRaw = leadTimeMa7 - leadTimeStdDev;
        channelLower = lowerRaw < 0 ? 0 : lowerRaw; // Não existe tempo negativo
        const upperRaw = leadTimeMa7 + leadTimeStdDev;
        channelHeight = upperRaw - channelLower;
      }

      return {
        ...day,
        ma7_entradas,
        ma30_entradas,
        ma7_separacoes,
        ma30_separacoes,
        
        // Lead Time Metrics
        leadTimeDaily: parseFloat((day.avgLeadTimeDaily || 0).toFixed(2)),
        leadTimeMa7: leadTimeMa7 ? parseFloat(leadTimeMa7.toFixed(2)) : null,
        leadTimeMa30: stats30.avg ? parseFloat(stats30.avg.toFixed(2)) : null,
        
        // Variáveis para o gráfico de Canal (Stacked Area trick)
        channelLower: channelLower ? parseFloat(channelLower.toFixed(2)) : null,
        channelHeight: channelHeight ? parseFloat(channelHeight.toFixed(2)) : null,
        leadTimeStdDev: leadTimeStdDev ? parseFloat(leadTimeStdDev.toFixed(2)) : null
      };
    });
  }, [data]);

  useEffect(() => {
    if (chartData.length > 0) {
      setVisibleRange({ startIndex: 0, endIndex: chartData.length - 1 });
    }
  }, [chartData]);

  const globalSummary = useMemo(() => {
    if (data.length === 0) return null;
    const total = data.length;
    
    // Médias globais de volume
    const totalEntradas = chartData.reduce((acc, c) => acc + (c.entradas || 0), 0);
    const totalSeparacoes = chartData.reduce((acc, c) => acc + (c.separacoes || 0), 0);
    const avgEntradasDiarias = (totalEntradas / chartData.length).toFixed(2);
    const avgSeparacoesDiarias = (totalSeparacoes / chartData.length).toFixed(2);
    
    // Médias globais de tempo
    // Filtra apenas dias que tiveram média válida para não baixar a média artificialmente
    const validLeadTimeDays = chartData.filter(d => d.leadTimeDaily > 0);
    const avgLeadTimeGlobal = validLeadTimeDays.length 
      ? (validLeadTimeDays.reduce((acc, c) => acc + c.leadTimeDaily, 0) / validLeadTimeDays.length).toFixed(1)
      : 0;

    return { total, avgEntradasDiarias, avgSeparacoesDiarias, totalDias: chartData.length, avgLeadTimeGlobal };
  }, [data, chartData]);

  const selectionSummary = useMemo(() => {
    if (chartData.length === 0) return null;
    const viewSlice = chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    
    const entradas = viewSlice.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
    const separacoes = viewSlice.reduce((acc, curr) => acc + (curr.separacoes || 0), 0);
    const diff = separacoes - entradas;
    
    // Cálculo de média de tempo no período selecionado
    const validDaysSlice = viewSlice.filter(d => d.leadTimeDaily > 0);
    const avgLeadTimePeriodo = validDaysSlice.length
      ? (validDaysSlice.reduce((acc, c) => acc + c.leadTimeDaily, 0) / validDaysSlice.length).toFixed(1)
      : 0;

    // Cálculo da estabilidade (Desvio Padrão Médio do período)
    const avgStdDev = viewSlice.length
       ? (viewSlice.reduce((acc, c) => acc + (c.leadTimeStdDev || 0), 0) / viewSlice.length).toFixed(1)
       : 0;

    return {
      entradas,
      separacoes,
      balanco: diff,
      numDias: viewSlice.length,
      mediaEntradasPeriodo: (entradas / viewSlice.length).toFixed(2),
      mediaSeparacoesPeriodo: (separacoes / viewSlice.length).toFixed(2),
      status: diff < 0 ? "Gargalo Crescente" : "Recuperação Ativa",
      avgLeadTimePeriodo,
      avgStdDev
    };
  }, [chartData, visibleRange]);

  const analyzeWithAI = async () => {
    if (!chartData.length || isAnalyzing) return;
    setIsAnalyzing(true);
    setAiError("");

    const viewSlice = chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    
    const systemPrompt = `Você é um Especialista em Supply Chain. 
    Analise os dados fornecidos focando em:
    1. EFICIÊNCIA DE FLUXO: Compare o volume de entrada vs. saída.
    2. TEMPO DE ATENDIMENTO (LEAD TIME): O tempo médio está aumentando ou diminuindo? A volatilidade (desvio padrão) está alta?
    3. RECOMENDAÇÃO: Ação prática baseada nos dados.
    
    Formatação: Use títulos em MAIÚSCULAS com emojis. Texto direto sem markdown complexo.`;

    const userQuery = `DADOS DO PERÍODO:
    Volume Entrada: ${selectionSummary.entradas} (${selectionSummary.mediaEntradasPeriodo}/dia)
    Volume Saída: ${selectionSummary.separacoes} (${selectionSummary.mediaSeparacoesPeriodo}/dia)
    Saldo: ${selectionSummary.balanco}
    
    TEMPO DE ATENDIMENTO (EXPEDIDOS):
    Média do Período: ${selectionSummary.avgLeadTimePeriodo} dias
    Volatilidade Média (Desvio Padrão): +/- ${selectionSummary.avgStdDev} dias
    
    Diagnostique se a operação está ganhando ou perdendo agilidade.`;

    const callWithRetry = async (retries = 0) => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });
        if (!response.ok) throw new Error('API Error');
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch (err) {
        if (retries < 3) {
          await new Promise(res => setTimeout(res, 2000));
          return callWithRetry(retries + 1);
        }
        throw err;
      }
    };

    try {
      const text = await callWithRetry();
      setAiAnalysis(text);
    } catch (err) {
      setAiError("Indisponível no momento.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900 leading-tight">
      <div className="w-full">
        {/* Header */}
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
            <Upload size={18} />
            {fileName || "Carregar Planilha"}
            <input type="file" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={!libLoaded} />
          </label>
        </header>

        {data.length > 0 ? (
          <div className="space-y-6">
            {/* KPI Section */}
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

              {/* KPI LEAD TIME */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-purple-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Lead Time Médio</p>
                <p className="text-2xl font-black text-slate-800">{selectionSummary.avgLeadTimePeriodo} <span className="text-xs text-slate-400 font-bold">dias</span></p>
                <div className="mt-1 text-[10px] text-purple-600 font-bold flex items-center gap-1">
                  <Clock size={12} /> (Expedidos)
                </div>
              </div>

              <div className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${selectionSummary.balanco >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Balanço</p>
                <div className="flex items-center justify-between">
                  <p className={`text-2xl font-black ${selectionSummary.balanco >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                    {selectionSummary.balanco > 0 ? `+${selectionSummary.balanco}` : selectionSummary.balanco}
                  </p>
                </div>
              </div>

              <button 
                onClick={analyzeWithAI}
                disabled={isAnalyzing}
                className="group p-6 rounded-3xl shadow-lg transition-all flex flex-col justify-center items-start bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 overflow-hidden"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-indigo-200 italic">Consultoria AI</p>
                <div className="flex items-center gap-2 w-full justify-between relative z-10">
                  <span className="text-lg font-bold">Analisar ✨</span>
                  {isAnalyzing ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                </div>
              </button>
            </div>

            {/* AI Diagnosis */}
            {(aiAnalysis || aiError) && (
              <div className="p-1 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-[34px] shadow-xl">
                <div className="p-8 md:p-10 bg-white rounded-[32px]">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-lg">
                      <Target size={20} />
                    </div>
                    <h3 className="text-lg font-black text-slate-800">Diagnóstico Operacional</h3>
                  </div>
                  <div className="text-slate-700 whitespace-pre-wrap leading-relaxed text-sm font-medium">
                    {aiAnalysis || aiError}
                  </div>
                </div>
              </div>
            )}

            {/* GRÁFICO 1: VOLUME */}
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
              <div className="mb-6">
                <h3 className="text-lg font-black text-slate-800">Volume de Fluxo (Entrada vs. Saída)</h3>
              </div>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} syncId="anyId">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={false} axisLine={false} height={0} />
                    <YAxis tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                      labelFormatter={(val) => `Data: ${new Date(val).toLocaleDateString('pt-BR')}`}
                    />
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '20px', fontSize: '11px', fontWeight: 700 }} />
                    
                    <Bar dataKey="entradas" name="Vol. Entrada" fill="#e2e8f0" barSize={8} radius={[4,4,0,0]} />
                    <Line type="monotone" dataKey="ma7_entradas" name="MM7 Liberação" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="ma7_separacoes" name="MM7 Separação" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* GRÁFICO 2: LEAD TIME & VOLATILIDADE */}
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
              <div className="mb-2 flex items-center gap-2">
                <Clock className="text-purple-600" size={20} />
                <h3 className="text-lg font-black text-slate-800">Tempo de Atendimento (Expedidos)</h3>
              </div>
              <p className="text-xs text-slate-400 mb-6 font-medium">
                Linha Sólida: Média 7 dias | Canal Roxo: Desvio Padrão (Variabilidade) | Linha Pontilhada: Histórico 30d
              </p>
              
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} syncId="anyId">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 9, fill: '#94a3b8', angle: -35, textAnchor: 'end', fontWeight: 600 }} 
                      axisLine={false}
                      height={60}
                      tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    />
                    <YAxis 
                      unit="d" 
                      tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} 
                      axisLine={false} 
                      tickLine={false} 
                      label={{ value: 'Dias', angle: -90, position: 'insideLeft', style: { fill: '#cbd5e1', fontSize: 10 } }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                      labelFormatter={(val) => `Separação: ${new Date(val).toLocaleDateString('pt-BR')}`}
                      formatter={(value, name) => [value ? `${value} dias` : 'N/A', name]}
                    />
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '20px', fontSize: '11px', fontWeight: 700 }} />

                    {/* Truque para Canal de Desvio Padrão usando Area Chart empilhado */}
                    <Area 
                      type="monotone" 
                      dataKey="channelLower" 
                      stackId="1" 
                      stroke="none" 
                      fill="transparent" 
                      legendType="none" 
                      activeDot={false}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="channelHeight" 
                      name="Volatilidade (Desvio)"
                      stackId="1" 
                      stroke="none" 
                      fill="#d8b4fe" 
                      opacity={0.3} 
                    />

                    {/* Linhas de Média */}
                    <Line type="monotone" dataKey="leadTimeMa30" name="MM30 (Longo Prazo)" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    <Line type="monotone" dataKey="leadTimeMa7" name="MM7 (Atendimento)" stroke="#7c3aed" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />

                    <Brush 
                      dataKey="date" 
                      height={40} 
                      stroke="#cbd5e1" 
                      fill="#f8fafc"
                      tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { month: 'short' })}
                      onChange={(r) => r && setVisibleRange({ startIndex: r.startIndex, endIndex: r.endIndex })}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        ) : (
          <div className="mt-32 flex flex-col items-center justify-center text-center">
            <div className="w-40 h-40 bg-white rounded-[50px] shadow-2xl flex items-center justify-center mb-8 border border-slate-100">
              <FileSpreadsheet size={60} className="text-indigo-500 opacity-20" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Supply Monitor 2.0</h2>
            <p className="text-slate-400 text-sm max-w-sm mt-2 leading-relaxed font-medium">
              Carregue seus dados para visualizar Fluxo e Lead Time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
