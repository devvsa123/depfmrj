import React, { useState, useMemo, useEffect } from 'react';
import {
LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
ComposedChart, Bar, Brush, Area, PieChart, Pie, Cell, BarChart
} from 'recharts';
import {
Upload, FileSpreadsheet, TrendingUp, CheckCircle2, Sparkles,
Loader2, Activity, Target, Clock, AlertCircle, XCircle, Package,
LayoutDashboard, Hourglass, AlertTriangle, ListFilter, X, Download
} from 'lucide-react';

const XLSX_SCRIPT_URL = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";

const App = () => {
const [data, setData] = useState([]);
const [fileName, setFileName] = useState("");
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
const [libLoaded, setLibLoaded] = useState(false);
// Controle de Abas
const [activeTab, setActiveTab] = useState("dashboard"); // 'dashboard' | 'backlog'

// Controle de Drill-down (Detalhes da Barra/Pizza)
const [selectedBucket, setSelectedBucket] = useState(null);
const [selectedPiSegment, setSelectedPiSegment] = useState(null); // 'delivered' | 'cancelled'

const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
const [aiAnalysis, setAiAnalysis] = useState("");
const [isAnalyzing, setIsAnalyzing] = useState(false);
const [aiError, setAiError] = useState("");

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

const handleDownloadExcel = (dataSet, sheetName) => {
if (!dataSet || dataSet.length === 0) return;
// Preparar dados para exportação (formatar datas, etc)
const exportData = dataSet.map(item => ({
PI: item.PI || "-",
PEDIDO: item.PEDIDO || "S/N",
STATUS: item.STATUS,
DATA_ENTRADA: item.entryDateIso || (item.DATA_ENTRADA ? safeGetISODate(item.DATA_ENTRADA) : "-"),
// Adiciona campos extras se disponíveis
...(item.daysOpen !== undefined ? { DIAS_EM_ABERTO: item.daysOpen } : {})
}));

const ws = window.XLSX.utils.json_to_sheet(exportData);
const wb = window.XLSX.utils.book_new();
window.XLSX.utils.book_append_sheet(wb, ws, "Dados");
window.XLSX.writeFile(wb, `${sheetName}_${new Date().toISOString().split('T')[0]}.xlsx`);
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

// --- NOVO: ANÁLISE DE BACKLOG & SAÚDE ---
const backlogAnalysis = useMemo(() => {
if (data.length === 0) return null;

const today = new Date();
// Filtra pedidos que NÃO são EXPEDIDO nem CANCELADO
const pendingOrders = data.filter(item => {
const status = String(item.STATUS || "").toUpperCase().trim();
return status !== "EXPEDIDO" && status !== "CANCELADO";
});

// Calcula dias em aberto
const pendingWithAge = pendingOrders.map(item => {
const entryDateIso = safeGetISODate(item.DATA_ENTRADA);
let daysOpen = 0;
if (entryDateIso) {
const entry = new Date(entryDateIso);
daysOpen = Math.floor((today - entry) / (1000 * 60 * 60 * 24));
}
return { ...item, daysOpen, entryDateIso };
}).sort((a, b) => b.daysOpen - a.daysOpen); // Ordena do mais antigo para o mais novo

// Buckets para Histograma (Aging)
const buckets = [
{ name: '0-3 Dias', min: 0, max: 3, count: 0, fill: '#10b981' }, // Green
{ name: '4-7 Dias', min: 4, max: 7, count: 0, fill: '#3b82f6' }, // Blue
{ name: '8-14 Dias', min: 8, max: 14, count: 0, fill: '#f59e0b' }, // Amber
{ name: '15-30 Dias', min: 15, max: 30, count: 0, fill: '#f97316' }, // Orange
{ name: '30+ Dias', min: 31, max: 99999, count: 0, fill: '#ef4444' } // Red
];

pendingWithAge.forEach(order => {
const bucket = buckets.find(b => order.daysOpen >= b.min && order.daysOpen <= b.max);
if (bucket) bucket.count++;
});

// Stats Gerais
const totalPending = pendingWithAge.length;
const avgAge = totalPending > 0
? (pendingWithAge.reduce((acc, curr) => acc + curr.daysOpen, 0) / totalPending).toFixed(1)
: 0;
const oldestOrder = totalPending > 0 ? pendingWithAge[0] : null;

// Distribuição por Status (dentro do backlog)
const statusDist = {};
pendingWithAge.forEach(order => {
const st = String(order.STATUS || "N/A").toUpperCase().trim();
statusDist[st] = (statusDist[st] || 0) + 1;
});
const statusChartData = Object.entries(statusDist).map(([name, value]) => ({ name, value }));

return {
pendingOrders: pendingWithAge,
buckets,
totalPending,
avgAge,
oldestOrder,
statusChartData,
topOffenders: pendingWithAge.slice(0, 10)
};
}, [data]);

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
.replace(/[#*`>-]/g, "") // remove markdown symbols
.replace(/---+/g, "") // remove separadores
.replace(/\n{3,}/g, "\n\n"); // normaliza quebras
setAiAnalysis(cleanedText.trim());
} catch (err) {
setAiError("Erro na análise.");
} finally {
setIsAnalyzing(false);
}
};

const renderPiDetailsModal = () => {
if (!selectedPiSegment) return null;

// Recalcula a lista de PIs/Pedidos baseada no segmento clicado (cancelled/delivered)
// e no período selecionado (visibleRange)
const startDate = new Date(chartData[visibleRange.startIndex]?.date);
const endDate = new Date(chartData[visibleRange.endIndex]?.date);
const targetType = selectedPiSegment; // 'delivered' | 'cancelled'

const filteredList = data.filter(item => {
const d = safeGetISODate(item.DATA_ENTRADA);
if (!d) return false;
const itemDate = new Date(d);
// Filtro de Data
if (itemDate < startDate || itemDate > endDate) return false;

// Filtro de Status
const status = String(item.STATUS || "").toUpperCase().trim();
const pi = item.PI;
if (!pi) return false; // Ignora itens sem PI

if (targetType === 'cancelled') {
return status === "CANCELADO";
} else if (targetType === 'delivered') {
return status === "EXPEDIDO";
}
return false;
});

const title = targetType === 'cancelled' ? 'PIs Cancelados no Período' : 'PIs Entregues no Período';
const colorClass = targetType === 'cancelled' ? 'text-red-600' : 'text-emerald-600';

return (
<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedPiSegment(null)}>
<div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
<div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
<div>
<h3 className={`text-xl font-black flex items-center gap-2 ${colorClass}`}>
<Package />
{title}
</h3>
<p className="text-sm text-slate-500 font-medium mt-1">
Listando {filteredList.length} registros no período selecionado
</p>
</div>
<div className="flex items-center gap-2">
<button
onClick={() => handleDownloadExcel(filteredList, `PIs_${targetType}`)}
className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors flex items-center gap-2 px-4 font-bold text-xs"
>
<Download size={16} /> Exportar
</button>
<button
onClick={() => setSelectedPiSegment(null)}
className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-700"
>
<X size={24} />
</button>
</div>
</div>
<div className="flex-1 overflow-auto p-0">
<table className="w-full text-sm text-left text-slate-600">
<thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
<tr>
<th className="px-6 py-4">PI</th>
<th className="px-6 py-4">Pedido</th>
<th className="px-6 py-4">Status</th>
<th className="px-6 py-4">Data Entrada</th>
</tr>
</thead>
<tbody>
{filteredList.map((order, idx) => (
<tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
<td className="px-6 py-4 font-bold text-slate-800 font-mono">{order.PI || "-"}</td>
<td className="px-6 py-4 font-medium text-slate-600">{order.PEDIDO || "S/N"}</td>
<td className="px-6 py-4">
<span className={`px-2 py-1 rounded-md text-xs font-bold border ${targetType === 'cancelled' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
{order.STATUS}
</span>
</td>
<td className="px-6 py-4 font-medium">
{order.DATA_ENTRADA ? safeGetISODate(order.DATA_ENTRADA).split('-').reverse().join('/') : '-'}
</td>
</tr>
))}
</tbody>
</table>
</div>
<div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
<button
onClick={() => setSelectedPiSegment(null)}
className="px-6 py-2 bg-white border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 transition-colors shadow-sm text-sm"
>
Fechar
</button>
</div>
</div>
</div>
);
};

const renderDashboard = () => (
<div className="space-y-6 animate-in fade-in zoom-in duration-300">
{/* Modal de Detalhes de PI */}
{renderPiDetailsModal()}

{/* KPIs */}
<div className="grid grid-cols-1 md:grid-cols-5 gap-4">
<div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
<p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Entradas (Corte)</p>
<p className="text-2xl font-black text-slate-800">{selectionSummary?.entradas.toLocaleString()}</p>
<div className="mt-1 text-[10px] text-indigo-600 font-bold flex items-center gap-1">
<TrendingUp size={12} /> {selectionSummary?.mediaEntradasPeriodo}/dia
</div>
</div>
<div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
<p className="text-emerald-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Saídas (Corte)</p>
<p className="text-2xl font-black text-slate-800">{selectionSummary?.separacoes.toLocaleString()}</p>
<div className="mt-1 text-[10px] text-emerald-600 font-bold flex items-center gap-1">
<CheckCircle2 size={12} /> {selectionSummary?.mediaSeparacoesPeriodo}/dia
</div>
</div>
<div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
<p className="text-purple-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Lead Time Médio</p>
<p className="text-2xl font-black text-slate-800">{selectionSummary?.avgLeadTimePeriodo} <span className="text-xs text-slate-400 font-bold">dias</span></p>
<div className="mt-1 text-[10px] text-purple-600 font-bold flex items-center gap-1">
<Clock size={12} /> (Expedidos)
</div>
</div>
<div className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${selectionSummary?.balanco >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
<p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 italic">Balanço</p>
<p className={`text-2xl font-black ${selectionSummary?.balanco >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
{selectionSummary?.balanco > 0 ? `+${selectionSummary?.balanco}` : selectionSummary?.balanco}
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
{/* Datas somente nas pontas */}
<div className="text-sm font-semibold text-slate-600">
{chartData[visibleRange.startIndex]?.date &&
chartData[visibleRange.endIndex]?.date && (
<>
{new Date(chartData[visibleRange.startIndex].date).toLocaleDateString('pt-BR')}
{" — "}
{new Date(chartData[visibleRange.endIndex].date).toLocaleDateString('pt-BR')}
</>
)}
</div>
</div>
<div className="h-[60px] w-full">
<ResponsiveContainer width="100%" height="100%">
<ComposedChart data={chartData}>
{/* XAxis invisível */}
<XAxis dataKey="date" hide />
<Brush
dataKey="date"
height={35}
stroke="#cbd5e1"
fill="#f1f5f9"
travellerWidth={12}
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
Taxa de Liberação X Taxa de Expedição
</h3>
<div className="h-[300px] w-full">
<ResponsiveContainer width="100%" height="100%">
<ComposedChart data={visibleData} syncId="masterSync">
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
Tempo de Atendimento
</h3>
<div className="bg-indigo-50 px-3 py-1 rounded-full text-[10px] text-indigo-600 font-black">
FILTRO: {selectionSummary?.numDias} DIAS
</div>
</div>
<div className="h-[420px] w-full">
<ResponsiveContainer width="100%" height="100%">
<ComposedChart data={visibleData} syncId="masterSync">
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
<h3 className="text-lg font-black text-slate-800">PI cancelados no período X PI fornecidos</h3>
</div>
<div className="flex flex-col md:flex-row items-center gap-8 h-[300px]">
<div className="w-full md:w-1/2 h-full">
<ResponsiveContainer width="100%" height="100%">
<PieChart>
<Pie
data={[
{ name: 'PIs Entregues', value: dynamicAnalysis.piStats.delivered, type: 'delivered' },
{ name: 'PIs Cancelados', value: dynamicAnalysis.piStats.cancelled, type: 'cancelled' }
]}
innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
onClick={(data) => {
if (data && data.payload) {
setSelectedPiSegment(data.payload.type);
}
}}
>
<Cell fill="#10b981" className="cursor-pointer hover:opacity-80 transition-opacity" />
<Cell fill="#f43f5e" className="cursor-pointer hover:opacity-80 transition-opacity" />
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
<p className="text-[10px] font-black text-red-400 uppercase">Taxa de cancelamento (Análise por PI)</p>
<p className="text-xl font-black text-red-600">
{dynamicAnalysis.piStats.totalUnique > 0 ? ((dynamicAnalysis.piStats.cancelled / dynamicAnalysis.piStats.totalUnique) * 100).toFixed(1) : 0}%
</p>
</div>
<p className="text-xs text-slate-400 text-center italic">Clique no gráfico para ver detalhes</p>
</div>
</div>
</div>
</div>
</div>
);

const renderBucketDetailsModal = () => {
if (!selectedBucket) return null;

const filteredOrders = backlogAnalysis.pendingOrders.filter(
order => order.daysOpen >= selectedBucket.min && order.daysOpen <= selectedBucket.max
);

return (
<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedBucket(null)}>
<div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
<div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
<div>
<h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
<ListFilter className="text-indigo-600" />
Detalhamento: {selectedBucket.name}
</h3>
<p className="text-sm text-slate-500 font-medium mt-1">
Listando {filteredOrders.length} pedidos nesta faixa de atraso
</p>
</div>
<div className="flex items-center gap-2">
<button
onClick={() => handleDownloadExcel(filteredOrders, `Backlog_${selectedBucket.name}`)}
className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors flex items-center gap-2 px-4 font-bold text-xs"
>
<Download size={16} /> Exportar
</button>
<button
onClick={() => setSelectedBucket(null)}
className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-700"
>
<X size={24} />
</button>
</div>
</div>
<div className="flex-1 overflow-auto p-0">
<table className="w-full text-sm text-left text-slate-600">
<thead className="text-xs text-slate-400 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
<tr>
<th className="px-6 py-4">Pedido</th>
<th className="px-6 py-4">PI</th>
<th className="px-6 py-4">Status</th>
<th className="px-6 py-4">Data Entrada</th>
<th className="px-6 py-4 text-right">Dias na Fila</th>
</tr>
</thead>
<tbody>
{filteredOrders.map((order, idx) => (
<tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
<td className="px-6 py-4 font-bold text-slate-800">{order.PEDIDO || "S/N"}</td>
<td className="px-6 py-4 font-mono text-slate-500">{order.PI || "-"}</td>
<td className="px-6 py-4">
<span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">
{order.STATUS}
</span>
</td>
<td className="px-6 py-4 font-medium">
{new Date(order.entryDateIso).toLocaleDateString('pt-BR')}
</td>
<td className="px-6 py-4 text-right">
<span className="font-bold text-slate-700">{order.daysOpen}</span>
</td>
</tr>
))}
</tbody>
</table>
</div>
<div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
<button
onClick={() => setSelectedBucket(null)}
className="px-6 py-2 bg-white border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 transition-colors shadow-sm text-sm"
>
Fechar
</button>
</div>
</div>
</div>
);
};

const renderBacklogAnalysis = () => {
if (!backlogAnalysis || backlogAnalysis.totalPending === 0) {
return (
<div className="mt-20 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
<div className="w-32 h-32 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
<CheckCircle2 size={48} className="text-emerald-500" />
</div>
<h2 className="text-2xl font-black text-slate-800">Fluxo Limpo!</h2>
<p className="text-slate-400 mt-2">Nenhum pedido pendente encontrado fora dos status Expedido/Cancelado.</p>
</div>
);
}

return (
<div className="space-y-8 animate-in fade-in zoom-in duration-300">
{/* Renderiza o Modal se houver seleção */}
{renderBucketDetailsModal()}

{/* KPIs de Backlog */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
<div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200 flex flex-col justify-between h-40">
<div>
<p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2">
<Hourglass size={14} /> Total em Aberto
</p>
<p className="text-4xl font-black text-slate-800">{backlogAnalysis.totalPending}</p>
</div>
<p className="text-xs text-slate-400 font-medium">Pedidos no fluxo interno</p>
</div>

<div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200 flex flex-col justify-between h-40">
<div>
<p className="text-orange-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2">
<Clock size={14} /> Idade Média da Fila
</p>
<p className="text-4xl font-black text-orange-600">{backlogAnalysis.avgAge} <span className="text-lg text-slate-400">dias</span></p>
</div>
<p className="text-xs text-slate-400 font-medium">Tempo médio desde a entrada</p>
</div>

<div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200 flex flex-col justify-between h-40 relative overflow-hidden">
<div className="relative z-10">
<p className="text-red-400 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-2">
<AlertTriangle size={14} /> Pedido Mais Antigo
</p>
<p className="text-4xl font-black text-red-600">
{backlogAnalysis.oldestOrder ? `${backlogAnalysis.oldestOrder.daysOpen} dias` : '-'}
</p>
</div>
{backlogAnalysis.oldestOrder && (
<div className="relative z-10 mt-2 bg-red-50 inline-block px-3 py-1 rounded-lg border border-red-100">
<p className="text-[10px] font-bold text-red-600">
Data: {new Date(backlogAnalysis.oldestOrder.entryDateIso).toLocaleDateString('pt-BR')}
</p>
</div>
)}
<AlertTriangle className="absolute -bottom-4 -right-4 text-red-50 opacity-50" size={120} />
</div>
</div>

{/* Gráficos de Aging e Status */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
{/* Histograma de Aging */}
<div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
<h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
<Activity className="text-indigo-500" /> Saúde do Fluxo (Aging de Pedidos)
</h3>
<p className="text-xs text-slate-400 mb-4 font-medium italic">Clique nas barras para ver os detalhes</p>
<div className="h-[350px] w-full">
<ResponsiveContainer width="100%" height="100%">
<BarChart data={backlogAnalysis.buckets} layout="vertical" onClick={(data) => {
if (data && data.activePayload && data.activePayload.length > 0) {
setSelectedBucket(data.activePayload[0].payload);
}
}}>
<CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
<XAxis type="number" hide />
<YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11, fontWeight: 700, fill: '#64748b'}} axisLine={false} />
<Tooltip cursor={{fill: '#f1f5f9', opacity: 0.5}} contentStyle={{borderRadius: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
<Bar dataKey="count" name="Pedidos" radius={[0, 4, 4, 0]} barSize={32} className="cursor-pointer">
{backlogAnalysis.buckets.map((entry, index) => (
<Cell key={`cell-${index}`} fill={entry.fill} className="hover:opacity-80 transition-opacity cursor-pointer" />
))}
</Bar>
</BarChart>
</ResponsiveContainer>
</div>
<div className="mt-4 flex justify-between text-xs text-slate-400 font-medium px-4">
<span>Recentes (Saudável)</span>
<span>Críticos (Risco)</span>
</div>
</div>

{/* Donut de Status */}
<div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
<h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
<ListFilter className="text-indigo-500" /> Onde estão parados?
</h3>
<div className="h-[350px] w-full flex items-center">
<ResponsiveContainer width="100%" height="100%">
<PieChart>
<Pie
data={backlogAnalysis.statusChartData}
innerRadius={80}
outerRadius={110}
paddingAngle={2}
dataKey="value"
>
{backlogAnalysis.statusChartData.map((entry, index) => (
<Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#ec4899'][index % 5]} />
))}
</Pie>
<Tooltip />
<Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '11px', fontWeight: '600'}} />
</PieChart>
</ResponsiveContainer>
</div>
</div>
</div>

{/* Tabela de Top Ofensores */}
<div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
<h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
<AlertTriangle className="text-red-500" /> Top 10 Pedidos Críticos (Fila de Espera)
</h3>
<button
onClick={() => handleDownloadExcel(backlogAnalysis.pendingOrders, `Relatorio_Completo_Backlog`)}
className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors"
>
<Download size={16} /> Baixar Lista Completa
</button>
</div>
<div className="overflow-x-auto">
<table className="w-full text-sm text-left text-slate-600">
<thead className="text-xs text-slate-400 uppercase bg-slate-50">
<tr>
<th className="px-6 py-4 rounded-l-xl">Pedido</th>
<th className="px-6 py-4">Status Atual</th>
<th className="px-6 py-4">Data Entrada</th>
<th className="px-6 py-4 text-right rounded-r-xl">Dias em Aberto</th>
</tr>
</thead>
<tbody>
{backlogAnalysis.topOffenders.map((order, idx) => (
<tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
<td className="px-6 py-4 font-bold text-slate-800">
{order.PEDIDO || order.PI || "S/N"}
</td>
<td className="px-6 py-4">
<span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md text-xs font-bold border border-indigo-100">
{order.STATUS}
</span>
</td>
<td className="px-6 py-4 font-medium">
{new Date(order.entryDateIso).toLocaleDateString('pt-BR')}
</td>
<td className="px-6 py-4 text-right">
<span className={`px-3 py-1 rounded-full text-xs font-black ${order.daysOpen > 30 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
{order.daysOpen} dias
</span>
</td>
</tr>
))}
</tbody>
</table>
</div>
</div>

</div>
);
};

return (
<div className="min-h-screen bg-slate-50 font-sans text-slate-900 overflow-x-hidden pb-20">
<div className="w-full px-4 py-4 md:px-10 md:py-8 transition-all duration-300">
<header className="mb-8 flex flex-col gap-6">
<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
</div>

{/* Navegação de Abas */}
{data.length > 0 && (
<div className="flex p-1 bg-white rounded-2xl border border-slate-200 w-fit shadow-sm self-center md:self-start">
<button
onClick={() => setActiveTab('dashboard')}
className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
>
<LayoutDashboard size={16} /> Histórico & Fluxo
</button>
<button
onClick={() => setActiveTab('backlog')}
className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'backlog' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
>
<Hourglass size={16} /> Backlog & Saúde
</button>
</div>
)}
</header>

{data.length > 0 ? (
activeTab === 'dashboard' ? renderDashboard() : renderBacklogAnalysis()
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
