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
  const [viewMode, setViewMode] = useState("dashboard");
  const [selectedStatus, setSelectedStatus] = useState(null);

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

  // =========================
  // DADOS VISÍVEIS (RECORTE DO BRUSH)
  // =========================
  const visibleData = useMemo(() => {
    if (!chartData.length) return [];

    return chartData.slice(
      visibleRange.startIndex,
      visibleRange.endIndex + 1
    );
  }, [chartData, visibleRange]);

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

  // ---------------- BACKLOG CRÍTICO ----------------

  const backlogAnalysis = useMemo(() => {
    if (!data.length) return [];
  
    const today = new Date();
  
    const activeOrders = data.filter(item => {
      const status = String(item.STATUS || "").toUpperCase().trim();
      return status !== "EXPEDIDO" && status !== "CANCELADO";
    });
  
    const enriched = activeOrders.map(item => {
      const entryDateStr = safeGetISODate(item.DATA_ENTRADA);
      if (!entryDateStr) return null;
  
      const entryDate = new Date(entryDateStr);
      const aging = Math.ceil((today - entryDate) / (1000 * 60 * 60 * 24));
  
      return { ...item, aging };
    }).filter(Boolean);
  
    const grouped = {};
  
    enriched.forEach(item => {
      const status = String(item.STATUS).toUpperCase().trim();
  
      if (!grouped[status]) {
        grouped[status] = {
          status,
          quantidade: 0,
          totalDias: 0,
          maxDias: 0
        };
      }
  
      grouped[status].quantidade += 1;
      grouped[status].totalDias += item.aging;
      grouped[status].maxDias = Math.max(grouped[status].maxDias, item.aging);
    });
  
    const arr = Object.values(grouped).map(g => ({
      ...g,
      mediaDias: parseFloat((g.totalDias / g.quantidade).toFixed(1))
    }));
  
    arr.sort((a, b) => b.totalDias - a.totalDias);
  
    const totalImpacto = arr.reduce((acc, c) => acc + c.totalDias, 0);
  
    let acumulado = 0;
    return arr.map(item => {
      acumulado += item.totalDias;
      return {
        ...item,
        percentual: parseFloat(((item.totalDias / totalImpacto) * 100).toFixed(1)),
        acumulado: parseFloat(((acumulado / totalImpacto) * 100).toFixed(1))
      };
    });
  
  }, [data]);


  useEffect(() => {
    if (chartData.length > 0) {
      setVisibleRange({ startIndex: 0, endIndex: chartData.length - 1 });
    }
  }, [chartData]);

  const analyzeWithAI = async () => {
    if (!chartData.length || isAnalyzing) return;
  
    setIsAnalyzing(true);
    setAiError("");
    setAiAnalysis("");
  
    // ====== MÉTRICAS HISTÓRICAS ======
    const totalEntradasHist = chartData.reduce((a, b) => a + (b.entradas || 0), 0);
    const totalSaidasHist = chartData.reduce((a, b) => a + (b.separacoes || 0), 0);
  
    const mediaHistoricaSaidas =
      totalSaidasHist / chartData.length;
  
    const picoHistorico =
      Math.max(...chartData.map(d => d.separacoes || 0));
  
    const mediaLeadHistorico =
      chartData.reduce((a, b) => a + (b.leadTimeDaily || 0), 0) /
      chartData.length;
  
    // ====== MÉTRICAS DO PERÍODO SELECIONADO ======
    const periodoSaidas = selectionSummary.separacoes;
    const periodoEntradas = selectionSummary.entradas;
    const periodoMediaDiaria =
      periodoSaidas / selectionSummary.numDias;
  
    const periodoLead = selectionSummary.avgLeadTimePeriodo;
  
    const userQuery = `
  Você é um consultor sênior de Supply Chain especializado em análise operacional.
  
  Analise os dados abaixo considerando TODO o histórico disponível e o período selecionado.
  
  DADOS HISTÓRICOS:
  - Total histórico de entradas: ${totalEntradasHist}
  - Total histórico de saídas: ${totalSaidasHist}
  - Média histórica diária de expedição: ${mediaHistoricaSaidas.toFixed(2)}
  - Pico histórico diário de expedição: ${picoHistorico}
  - Lead Time médio histórico: ${mediaLeadHistorico.toFixed(2)} dias
  
  DADOS DO PERÍODO SELECIONADO:
  - Entradas no período: ${periodoEntradas}
  - Saídas no período: ${periodoSaidas}
  - Média diária de expedição no período: ${periodoMediaDiaria.toFixed(2)}
  - Lead Time médio no período: ${periodoLead} dias
  
  QUERO QUE VOCÊ:
  1. Compare o desempenho atual com a média histórica.
  2. Informe se a taxa de expedição está acima, dentro ou abaixo da média.
  3. Avalie se estamos próximos de um pico histórico.
  4. Identifique possível sazonalidade.
  5. Avalie tendência (crescimento, estabilidade ou queda).
  6. Diga se existe risco de formação de backlog.
  7. Forneça uma previsão qualitativa de demanda com base na sazonalidade observada.
  8. Escreva em formato executivo, direto, sem tabelas, sem fórmulas matemáticas.
  9. Finalize com um parecer estratégico claro.
  
  Não use tabelas.
  Não repita os números em formato de cálculo.
  Seja analítico e estratégico.
  `;
  
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userQuery }] }],
          }),
        }
      );
  
      const result = await response.json();
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

      const cleanedText = rawText
        .replace(/[#*`>-]/g, "")      // remove markdown symbols
        .replace(/---+/g, "")         // remove separadores
        .replace(/\n{3,}/g, "\n\n");  // normaliza quebras
      
      setAiAnalysis(cleanedText.trim());
    } catch (err) {
      setAiError("Erro na análise.");
    } finally {
      setIsAnalyzing(false);
    }
  };

    // ============================
    // RENDERIZAÇÕES SEPARADAS
    // ============================
  
    const renderEmptyState = () => (
      <div className="mt-32 flex flex-col items-center justify-center text-center">
        <div className="w-40 h-40 bg-white rounded-[50px] shadow-2xl flex items-center justify-center mb-8 border border-slate-100">
          <FileSpreadsheet size={60} className="text-indigo-500 opacity-20" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          Supply Monitor 3.6
        </h2>
        <p className="text-slate-400 text-sm max-w-sm mt-2 font-medium">
          Importe o arquivo do WMS para visualizar o painel analítico histórico.
        </p>
      </div>
    );
  
    const renderBacklog = () => (
      <div className="space-y-8">
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
          <h3 className="text-xl font-black text-slate-800 mb-6">
            Pareto de Backlog por Status
          </h3>
  
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={backlogAnalysis}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                <Tooltip />
                <Legend />
  
                <Bar
                  yAxisId="left"
                  dataKey="totalDias"
                  name="Impacto (Dias Acumulados)"
                  fill="#6366f1"
                  onClick={(d) => setSelectedStatus(d.status)}
                />
  
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="acumulado"
                  name="% Acumulado"
                  stroke="#ef4444"
                  strokeWidth={3}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
  
        {selectedStatus && (
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
            <h4 className="text-lg font-black mb-4">
              Pedidos no Status: {selectedStatus}
            </h4>
  
            <div className="max-h-[400px] overflow-auto text-sm">
              <table className="w-full text-left">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2">Pedido</th>
                    <th className="p-2">Data Entrada</th>
                    <th className="p-2">Dias em Aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {data
                    .filter(
                      (item) =>
                        String(item.STATUS).toUpperCase().trim() ===
                        selectedStatus
                    )
                    .map((item, idx) => {
                      const entry = safeGetISODate(item.DATA_ENTRADA);
                      const aging = entry
                        ? Math.ceil(
                            (new Date() - new Date(entry)) /
                              (1000 * 60 * 60 * 24)
                          )
                        : "-";
  
                      return (
                        <tr key={idx} className="border-b">
                          <td className="p-2">
                            {item.PEDIDO || item.PI || "-"}
                          </td>
                          <td className="p-2">
                            {entry
                              ? new Date(entry).toLocaleDateString("pt-BR")
                              : "-"}
                          </td>
                          <td className="p-2 font-bold">{aging}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  
    const renderDashboard = () => (
      <div className="space-y-6">
        {/* TODO: Aqui permanece TODO seu conteúdo atual do dashboard
            (KPIs + gráficos + AI + cancelamentos)
            NÃO alterei essa parte para não duplicar 1000 linhas novamente.
            Basta deixar exatamente como já está dentro do seu bloco atual.
        */}
      </div>
    );
  
    // ============================
    // RETURN PRINCIPAL LIMPO
    // ============================
  
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900 overflow-x-hidden">
        <div className="w-full px-4 py-4 md:px-10 md:py-8 transition-all duration-300">
          <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* HEADER ORIGINAL MANTIDO */}
          </header>
  
          {data.length === 0 && renderEmptyState()}
          {data.length > 0 && viewMode === "dashboard" && renderDashboard()}
          {data.length > 0 && viewMode === "backlog" && renderBacklog()}
        </div>
      </div>
    );
  };

export default App;

