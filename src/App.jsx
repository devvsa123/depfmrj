import React, { useState, useMemo, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ComposedChart, Bar, Brush
} from 'recharts';
import { 
  Upload, FileSpreadsheet, BarChart3, TrendingUp, Calendar, 
  AlertCircle, CheckCircle2, Sparkles, Loader2, MessageSquare, PackageCheck, Info,
  AlertTriangle, Clock, ArrowRightLeft, Activity, Target, Zap
} from 'lucide-react';

const XLSX_SCRIPT_URL = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";

const App = () => {
  const [data, setData] = useState([]);
  const [rawTotalBeforeFilter, setRawTotalBeforeFilter] = useState(0);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [libLoaded, setLibLoaded] = useState(false);
  
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
  
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");

  // No ambiente Canvas, a chave é injetada automaticamente. 
  // Para deploy no Vite/Vercel, substitua "" por import.meta.env.VITE_GEMINI_API_KEY
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

        setRawTotalBeforeFilter(jsonData.length);

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
        setError("Erro ao processar o arquivo.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const statsByDate = {};
    
    data.forEach(item => {
      const entryDate = safeGetISODate(item.DATA_ENTRADA);
      const separationDate = safeGetISODate(item.DATA_SEPARACAO);
      
      if (entryDate) {
        if (!statsByDate[entryDate]) statsByDate[entryDate] = { date: entryDate, entradas: 0, separacoes: 0 };
        statsByDate[entryDate].entradas += 1;
      }
      if (separationDate) {
        if (!statsByDate[separationDate]) statsByDate[separationDate] = { date: separationDate, entradas: 0, separacoes: 0 };
        statsByDate[separationDate].separacoes += 1;
      }
    });
    
    const sortedDates = Object.values(statsByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const calculateMA = (arr, index, period, key) => {
      if (index < period - 1) return null;
      let sum = 0;
      for (let i = 0; i < period; i++) sum += (arr[index - i][key] || 0);
      return parseFloat((sum / period).toFixed(2));
    };

    return sortedDates.map((day, idx) => ({
      ...day,
      ma7_entradas: calculateMA(sortedDates, idx, 7, 'entradas'),
      ma30_entradas: calculateMA(sortedDates, idx, 30, 'entradas'),
      ma7_separacoes: calculateMA(sortedDates, idx, 7, 'separacoes'),
      ma30_separacoes: calculateMA(sortedDates, idx, 30, 'separacoes'),
    }));
  }, [data]);

  useEffect(() => {
    if (chartData.length > 0) {
      setVisibleRange({ startIndex: 0, endIndex: chartData.length - 1 });
    }
  }, [chartData]);

  const globalSummary = useMemo(() => {
    if (data.length === 0) return null;
    const totalEntradas = chartData.reduce((acc, c) => acc + (c.entradas || 0), 0);
    const totalSeparacoes = chartData.reduce((acc, c) => acc + (c.separacoes || 0), 0);
    const avgEntradasDiarias = (totalEntradas / chartData.length).toFixed(2);
    const avgSeparacoesDiarias = (totalSeparacoes / chartData.length).toFixed(2);
    return { total: data.length, avgEntradasDiarias, avgSeparacoesDiarias, totalDias: chartData.length };
  }, [data, chartData]);

  const selectionSummary = useMemo(() => {
    if (chartData.length === 0) return null;
    const viewSlice = chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    const entradas = viewSlice.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
    const separacoes = viewSlice.reduce((acc, curr) => acc + (curr.separacoes || 0), 0);
    const diff = separacoes - entradas;
    return {
      entradas,
      separacoes,
      balanco: diff,
      numDias: viewSlice.length,
      mediaEntradasPeriodo: (entradas / viewSlice.length).toFixed(2),
      mediaSeparacoesPeriodo: (separacoes / viewSlice.length).toFixed(2),
      status: diff < 0 ? "Gargalo Crescente" : "Recuperação Ativa"
    };
  }, [chartData, visibleRange]);

  const analyzeWithAI = async () => {
    if (!chartData.length || isAnalyzing) return;
    setIsAnalyzing(true);
    setAiError("");

    const viewSlice = chartData.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    
    const systemPrompt = `Você é um Consultor Estratégico de Operações Senior especializado em Logística. 
    Sua missão é fornecer um diagnóstico equilibrado sobre o fluxo de pedidos.
    
    FOCO PRINCIPAL: 
    1. SAZONALIDADE: Identifique se o volume de liberação (entradas) do período selecionado está acima da média histórica (pico sazonal) ou abaixo. 
    2. CAPACIDADE: Avalie se a capacidade de separação está sendo mantida constante.
    3. EQUILÍBRIO: Determine se o gargalo é passageiro (causado por pico de entrada) ou estrutural (capacidade de saída insuficiente).
    4. PROJEÇÃO: A tendência é o gargalo diminuir se o fluxo de entrada normalizar?

    REGRAS DE FORMATAÇÃO:
    - NÃO USE asteriscos (**) ou símbolos de markdown. Use apenas texto plano.
    - Organize por blocos com títulos em LETRAS MAIÚSCULAS precedidos por Emojis.
    - Seja analítico, porém direto. Evite textos muito longos ou muito curtos.
    - Destaque números críticos apenas com texto.`;

    const userQuery = `DADOS HISTÓRICOS DA OPERAÇÃO:
    Média Global de Entradas: ${globalSummary.avgEntradasDiarias}/dia
    Média Global de Separações: ${globalSummary.avgSeparacoesDiarias}/dia

    PERÍODO SELECIONADO ATUAL:
    Datas: ${viewSlice[0]?.date} até ${viewSlice[viewSlice.length - 1]?.date}
    Volume Liberado: ${selectionSummary.entradas} (Média de ${selectionSummary.mediaEntradasPeriodo}/dia)
    Volume Separado: ${selectionSummary.separacoes} (Média de ${selectionSummary.mediaSeparacoesPeriodo}/dia)
    Saldo Acumulado no Corte: ${selectionSummary.balanco}

    Faça um diagnóstico considerando o fator sazonal e o comportamento da capacidade de separação.`;

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
        if (!response.ok) throw new Error('API busy');
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch (err) {
        if (retries < 5) {
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(res => setTimeout(res, delay));
          return callWithRetry(retries + 1);
        }
        throw err;
      }
    };

    try {
      const text = await callWithRetry();
      setAiAnalysis(text);
    } catch (err) {
      setAiError("Não foi possível gerar a análise agora. Tente em alguns instantes.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900 leading-tight">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-lg">
              <Activity className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">Supply Chain <span className="text-indigo-600 font-bold underline decoration-indigo-200 decoration-2">Expert DepFMRJ</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Visibilidade Sazonal e Operacional</p>
            </div>
          </div>
          
          <label className="cursor-pointer px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm bg-white border border-slate-200 hover:border-indigo-500 hover:text-indigo-600 text-sm">
            <Upload size={18} />
            {fileName || "Carregar Operação"}
            <input type="file" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={!libLoaded} />
          </label>
        </header>

        {data.length > 0 ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-all group">
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1 group-hover:text-indigo-600 transition-colors">Entradas (Corte)</p>
                <p className="text-3xl font-black text-slate-800">{selectionSummary.entradas.toLocaleString()}</p>
                <div className="mt-2 text-[10px] text-indigo-600 font-bold flex items-center gap-1">
                  <TrendingUp size={12} /> {selectionSummary.mediaEntradasPeriodo}/dia
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-all group">
                <p className="text-emerald-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Saídas (Corte)</p>
                <p className="text-3xl font-black text-slate-800">{selectionSummary.separacoes.toLocaleString()}</p>
                <div className="mt-2 text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                  <CheckCircle2 size={12} /> {selectionSummary.mediaSeparacoesPeriodo}/dia
                </div>
              </div>

              <div className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${selectionSummary.balanco >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Balanço do Recorte</p>
                <div className="flex items-center justify-between">
                  <p className={`text-3xl font-black ${selectionSummary.balanco >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                    {selectionSummary.balanco > 0 ? `+${selectionSummary.balanco.toLocaleString()}` : selectionSummary.balanco.toLocaleString()}
                  </p>
                  <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold uppercase ${selectionSummary.balanco >= 0 ? 'bg-emerald-200 text-emerald-800 shadow-sm' : 'bg-orange-200 text-orange-800 shadow-sm'}`}>
                    {selectionSummary.status}
                  </span>
                </div>
              </div>

              <button 
                onClick={analyzeWithAI}
                disabled={isAnalyzing}
                className="group p-6 rounded-3xl shadow-lg transition-all flex flex-col justify-center items-start bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 overflow-hidden"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-indigo-200 italic">Diagnóstico Sazonal</p>
                <div className="flex items-center gap-2 w-full justify-between relative z-10">
                  <span className="text-lg font-black tracking-tight">Gerar Relatório ✨</span>
                  {isAnalyzing ? <Loader2 size={24} className="animate-spin text-white" /> : <Sparkles size={24} className="text-blue-300" />}
                </div>
              </button>
            </div>

            {(aiAnalysis || aiError) && (
              <div className="p-1 bg-gradient-to-br from-indigo-100 to-blue-50 rounded-[34px] shadow-xl animate-in zoom-in-95 duration-500">
                <div className="p-8 md:p-10 bg-white rounded-[32px]">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="p-3.5 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-100 border border-indigo-500">
                      <Target size={26} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-slate-800 tracking-tight">Relatório de Consultoria Operacional</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Integração de médias históricas e dados do corte</p>
                    </div>
                  </div>
                  
                  <div className="text-slate-700 whitespace-pre-wrap leading-relaxed text-base font-medium font-sans bg-slate-50/50 p-6 rounded-2xl border border-slate-100 italic">
                    {aiAnalysis || aiError}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white p-8 md:p-10 rounded-[40px] shadow-sm border border-slate-200">
              <div className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Tendência de Fluxo e Sazonalidade</h3>
                  <p className="text-sm text-slate-400 mt-1 italic font-medium">Os indicadores acima sincronizam automaticamente com a barra de seleção inferior.</p>
                </div>
                <div className="flex gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
                   <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <span className="w-3 h-3 rounded-full bg-blue-500 shadow-md"></span> Liberação
                   </div>
                   <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-md"></span> Separação
                   </div>
                </div>
              </div>
              
              <div className="h-[500px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 10, fill: '#94a3b8', angle: -35, textAnchor: 'end', fontWeight: 700 }} 
                      axisLine={false}
                      tickLine={false}
                      height={90}
                      tickFormatter={(val) => {
                        const d = new Date(val);
                        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                      }}
                      interval="preserveStartEnd"
                      minTickGap={15}
                    />
                    <YAxis tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 700}} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '20px' }}
                      labelFormatter={(val) => `Data: ${new Date(val).toLocaleDateString('pt-BR')}`}
                    />
                    <Legend 
                      verticalAlign="top" 
                      align="right" 
                      iconType="circle" 
                      wrapperStyle={{ paddingBottom: '40px', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }} 
                    />
                    
                    <Bar dataKey="entradas" name="Vol. Entrada" fill="#e2e8f0" barSize={10} radius={[5,5,0,0]} opacity={0.5} />
                    
                    <Line type="monotone" dataKey="ma7_entradas" name="MM7 Liberação" stroke="#3b82f6" strokeWidth={4} dot={false} activeDot={{ r: 8, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="ma7_separacoes" name="MM7 Separação" stroke="#10b981" strokeWidth={4} dot={false} activeDot={{ r: 8, strokeWidth: 0 }} />
                    
                    <Line type="monotone" dataKey="ma30_entradas" name="Histórico (30d)" stroke="#1e40af" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
                    <Line type="monotone" dataKey="ma30_separacoes" name="Histórico (30d)" stroke="#065f46" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />

                    <Brush 
                      dataKey="date" 
                      height={50} 
                      stroke="#e2e8f0" 
                      fill="#fff"
                      onChange={(r) => r && setVisibleRange({ startIndex: r.startIndex, endIndex: r.endIndex })}
                      tickFormatter={(val) => {
                         const d = new Date(val);
                         return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
               <div className="flex items-center gap-4 text-sm font-bold text-slate-400 uppercase tracking-widest">
                  <Activity size={20} className="text-indigo-600" />
                  <span>Sincronizado com {globalSummary.totalDias} dias de histórico operacional</span>
               </div>
               {globalSummary.semDataEntrada > 0 && (
                <div className="flex items-center gap-2 text-amber-600 text-[10px] font-black uppercase bg-amber-50 px-5 py-2.5 rounded-full border border-amber-100 shadow-sm">
                  <AlertTriangle size={16} />
                  {globalSummary.semDataEntrada.toLocaleString()} Pedidos ignorados por falta de data válida
                </div>
               )}
            </div>
          </div>
        ) : (
          <div className="mt-32 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-700">
            <div className="w-52 h-52 bg-white rounded-[70px] shadow-2xl flex items-center justify-center mb-10 border border-slate-50 relative">
               <div className="absolute inset-0 bg-indigo-500/5 animate-pulse rounded-[70px]"></div>
              <FileSpreadsheet size={80} className="text-indigo-600 opacity-20 relative z-10" />
            </div>
            <h2 className="text-4xl font-black text-slate-800 tracking-tighter">Supply Expert DepFMRJ</h2>
            <p className="text-slate-400 text-sm max-w-sm mt-4 leading-relaxed font-bold uppercase tracking-widest opacity-60">
              Analise tendências, identifique picos sazonais e gerencie sua capacidade operacional.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
